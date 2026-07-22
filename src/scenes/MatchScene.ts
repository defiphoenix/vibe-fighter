import * as Phaser from "phaser";
import { World } from "../sim/world";
import { STAGE_WIDTH, STAGE_HEIGHT, VIEW_WIDTH } from "../sim/constants";
import { EdgeLatch, InputReader } from "./input";
import { drawDebugBoxes, allBounds, BOUND_KINDS, type BoundsToggles } from "../render/boxes";
import { CpuController, DAMAGE_SCALE } from "../sim/cpu";
import type { Difficulty } from "../sim/cpu";
import type { MatchConfig } from "./flow-state";
import type { MatchPhase } from "../sim/match";
import { Hud } from "../render/hud";
import { buildStage } from "../render/stage";
import type { StagesFile } from "../render/stage";
import { loadRegistry, buildConfig } from "../render/characters";
import { FighterSprite } from "../render/fighter-sprite";
import type { InputSnapshot, SimEvent } from "../sim/types";

// What a match looks like with nobody having chosen anything. FlowScene normally supplies all of it
// through scene.start("Match", cfg); this keeps `?scene=match` (DEV) and any direct start bootable.
const DEFAULT_CONFIG: MatchConfig = {
  mode: "1v1",
  difficulty: "normal",
  stageId: "twilight",
  fighters: ["brawler", "jiujitsu"],
};

const DIFFICULTIES: Difficulty[] = ["easy", "normal", "hard"];

/**
 * Field-by-field merge over the defaults, because `init` data is untyped at runtime: it arrives from
 * `scene.start`, from a DEV `?scene=match` boot, or from anything a console user types. A plain
 * spread lets `{ fighters: undefined }` OVERWRITE the default and then throw a bare TypeError on
 * destructuring, and lets an unknown `mode` silently mean 1v1 or an unknown difficulty build a
 * controller with undefined knobs that only explodes on its first decision. A malformed value falls
 * back to the default; a well-formed but unknown id still fails loudly in create().
 */
function sanitizeConfig(data?: Partial<MatchConfig>): MatchConfig {
  const d = data ?? {};
  const pair = Array.isArray(d.fighters) && d.fighters.length === 2 && d.fighters.every((f) => typeof f === "string" && f)
    ? ([d.fighters[0], d.fighters[1]] as [string, string])
    : DEFAULT_CONFIG.fighters;
  return {
    mode: d.mode === "cpu" || d.mode === "1v1" ? d.mode : DEFAULT_CONFIG.mode,
    difficulty: d.difficulty && DIFFICULTIES.includes(d.difficulty) ? d.difficulty : DEFAULT_CONFIG.difficulty,
    stageId: typeof d.stageId === "string" && d.stageId ? d.stageId : DEFAULT_CONFIG.stageId,
    fighters: pair,
  };
}

// Camera-juice magnitudes. ponytail: eyeball-tuned; adjust to taste, no sim coupling.
const HIT_SHAKE_MS = 120;
const HIT_SHAKE_BASE = 0.004;
const HIT_SHAKE_PER_DMG = 0.0004;
/** How long the mid-fight "press Esc again" window stays open. */
const QUIT_CONFIRM_MS = 2000;
const HIT_SHAKE_MAX = 0.012;
const KO_SHAKE_MS = 320;
const KO_SHAKE_INTENSITY = 0.02;
const KO_FLASH_MS = 220;
const BLOCK_SHAKE_MS = 90;
const BLOCK_SHAKE_INTENSITY = 0.003;

export class MatchScene extends Phaser.Scene {
  private world!: World;
  private reader!: InputReader;
  private debugG!: Phaser.GameObjects.Graphics;
  private sprites!: [FighterSprite, FighterSprite];
  private hud!: Hud;
  private cfg: MatchConfig = DEFAULT_CONFIG;
  private cpu?: CpuController;
  // Debug bounds default OFF in the shipped match (the Playground defaults them on — that's a
  // tuning tool). `debug` gates the whole overlay; `bounds` picks which kinds it draws.
  private debug = false;
  private bounds: BoundsToggles = allBounds(true);
  private debugKey!: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private menuKey!: Phaser.Input.Keyboard.Key;
  private boundKeys!: Phaser.Input.Keyboard.Key[];
  private prevDebugDown = false;
  private prevRestartDown = false;
  private prevMenuDown = false;
  // Esc quits to the menu, but mid-fight it asks first: one stray keypress should not throw away a
  // match in progress. Armed by the first press, disarmed by a Time.Clock timer (never a tween —
  // tweens run on the wall clock and don't advance under the e2e's pumped step).
  private quitArmed = false;
  private quitPrompt!: Phaser.GameObjects.Text;
  private quitTimer?: Phaser.Time.TimerEvent;
  private prevPhase: MatchPhase = "intro";
  // latched pressed-edges: keep a press alive until a sim tick consumes it (rate-independent)
  private latch = new EdgeLatch();
  // dev-only: acceptance tests hold inputs through the real input->sim path (no synthetic keys).
  private testHoldP1: Partial<InputSnapshot> = {};
  private testHoldP2: Partial<InputSnapshot> = {};

  constructor() {
    super("Match");
  }

  /** Selection arrives from FlowScene via scene.start("Match", cfg). State is reset HERE, not in the
   *  constructor: the scene is re-entered (Esc → Flow → a new match), and adapter state that
   *  survives that round trip is state from the previous match. In particular the EdgeLatch — an
   *  attack pressed on the match-end screen is never consumed (matchEnd ticks aren't actionable), so
   *  a latch carried over would fire it on the first actionable tick of the NEXT match. */
  init(data?: Partial<MatchConfig>): void {
    this.cfg = sanitizeConfig(data);
    this.debug = false;
    this.bounds = allBounds(true);
    this.cpu = undefined;
    this.latch = new EdgeLatch();
    this.testHoldP1 = {};
    this.testHoldP2 = {};
    this.prevDebugDown = false;
    this.prevRestartDown = false;
    this.prevMenuDown = false;
    this.quitArmed = false;
    this.quitTimer = undefined;
    this.prevPhase = "intro";
  }

  create(): void {
    const reg = loadRegistry(this.cache.json);
    const [idA, idB] = this.cfg.fighters;
    for (const id of this.cfg.fighters) {
      if (!reg[id]) throw new Error(`Match: registry is missing the "${id}" fighter (character-gym.json)`);
    }
    this.world = new World(buildConfig(idA, reg[idA]), buildConfig(idB, reg[idB]));
    this.reader = new InputReader(this);
    // P2 is the CPU in 1vCPU. Handed to world.advance as a per-TICK seam, never sampled per frame.
    if (this.cfg.mode === "cpu") {
      this.cpu = new CpuController(1, this.cfg.difficulty);
      // ...and it hits softer than you do. Behaviour knobs decide how OFTEN it touches you; this
      // decides what a touch costs. Survives resets on purpose — it's a match-long handicap.
      this.world.fighters[1].damageScale = DAMAGE_SCALE[this.cfg.difficulty];
    }

    if (import.meta.env.DEV) {
      const w = window as unknown as {
        __world: World;
        __holdP1: (v: Partial<InputSnapshot>) => void;
        __holdP2: (v: Partial<InputSnapshot>) => void;
        __quitArmed: () => boolean;
      };
      w.__world = this.world;
      w.__quitArmed = () => this.quitArmed;
      w.__holdP1 = (v) => { this.testHoldP1 = v ?? {}; };
      w.__holdP2 = (v) => { this.testHoldP2 = v ?? {}; };
      // Drop the hooks with the scene. Since Esc returns to the flow, a surviving `__world` is a
      // STOPPED match still answering questions while the menu is up — and the hold closures would
      // write into a dead scene's fields.
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        const g = window as unknown as Record<string, unknown>;
        for (const k of ["__world", "__holdP1", "__holdP2", "__sprites", "__stage", "__quitArmed"]) delete g[k];
      });
    }

    // Build the chosen stage (parallax layers + props). Camera scrolls a world wider than the
    // viewport. The id is validated the same fail-fast way loadRegistry/buildStage are: a stage that
    // isn't there must not render an empty world, and `_doc` is metadata, not a stage.
    const stages = this.cache.json.get("stages") as StagesFile;
    const stageId = this.cfg.stageId;
    if (stageId.startsWith("_") || !stages[stageId]) {
      throw new Error(`Match: unknown stage "${stageId}" (stages.json)`);
    }
    const stage = buildStage(this, stages[stageId]);
    this.cameras.main.setBounds(0, 0, STAGE_WIDTH, STAGE_HEIGHT);
    if (import.meta.env.DEV) {
      (window as unknown as { __stage: unknown }).__stage = { cam: this.cameras.main, layers: stage.layers };
    }

    this.debugG = this.add.graphics().setDepth(50);
    this.hud = new Hud(this);

    // Both fighters are sprite-driven with per-state animation switching (feet-anchored, mirrored).
    this.sprites = [
      new FighterSprite(this, idA, reg[idA].render, reg[idA].data.stats.scale, reg[idA].data),
      new FighterSprite(this, idB, reg[idB].render, reg[idB].data.stats.scale, reg[idB].data),
    ];
    if (import.meta.env.DEV) {
      (window as unknown as { __sprites: Phaser.GameObjects.Sprite[] }).__sprites = this.sprites.map((s) => s.sprite);
    }

    const kb = this.input.keyboard!;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    this.debugKey = kb.addKey(KC.B);
    this.restartKey = kb.addKey(KC.ENTER);
    this.menuKey = kb.addKey(KC.ESC);
    // 1-4 pick which bound kinds the overlay draws, same order as BOUND_KINDS (hurt/hit/push/guard);
    // B still toggles the overlay itself.
    this.boundKeys = [KC.ONE, KC.TWO, KC.THREE, KC.FOUR].map((k) => kb.addKey(k));

    // On-screen control legend: one compact line in the bottom strip (below the feet line so it
    // never covers the fighters). White + thin outline for legibility over the busy stage; surfaces
    // the non-obvious keys — crouch = hold down, block = a dedicated key (P1 Q, P2 /), and low/air
    // attacks come from attacking while crouching / airborne.
    this.add
      .text(
        VIEW_WIDTH / 2,
        STAGE_HEIGHT - 6,
        "P1 A/D·W·S crouch·Q block·F/G   |   P2 ←→·↑·↓·/ block·,/.   |   CROUCH attacks are LOWS: block CROUCHING (ground normals and jump-ins are HIGH: block STANDING)   |   B hitboxes · 1-4 kinds · Enter rematch · Esc menu",
        { fontFamily: "monospace", fontSize: "14px", color: "#ffffff", stroke: "#000000", strokeThickness: 3 },
      )
      .setOrigin(0.5, 1)
      .setDepth(101)
      .setScrollFactor(0);

    // The mid-fight quit confirmation. Built once and hidden; screen-space like the rest of the HUD.
    this.quitPrompt = this.add
      .text(VIEW_WIDTH / 2, 96, "PRESS ESC AGAIN TO QUIT", {
        fontFamily: "monospace",
        fontSize: "26px",
        color: "#ffe27a",
        stroke: "#000000",
        strokeThickness: 5,
      })
      .setOrigin(0.5, 0.5)
      .setDepth(102)
      .setScrollFactor(0)
      .setVisible(false);
  }

  /** First Esc mid-fight: show the prompt and open a short window for the confirming press. */
  private armQuit(): void {
    this.quitArmed = true;
    this.quitPrompt.setVisible(true);
    this.quitTimer?.remove();
    this.quitTimer = this.time.delayedCall(QUIT_CONFIRM_MS, () => this.disarmQuit());
  }

  /** Close the window. The timeout is only ONE of the ways it should close: a rematch or a round
   *  change means the match the player was asked about is gone, and a confirmation that outlives its
   *  question turns the next Esc into an instant quit the player never agreed to. */
  private disarmQuit(): void {
    this.quitArmed = false;
    this.quitPrompt.setVisible(false);
    this.quitTimer?.remove();
    this.quitTimer = undefined;
  }

  update(time: number, delta: number): void {
    const dDown = this.debugKey.isDown;
    if (dDown && !this.prevDebugDown) this.debug = !this.debug;
    this.prevDebugDown = dDown;

    this.boundKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        const kind = BOUND_KINDS[i];
        this.bounds = { ...this.bounds, [kind]: !this.bounds[kind] };
        this.debug = true; // toggling a kind with the overlay off is otherwise a silent no-op
      }
    });

    const mDown = this.menuKey.isDown;
    if (mDown && !this.prevMenuDown) {
      // Nothing left to lose once the match is decided, so leave immediately. Otherwise the first
      // press only arms the prompt — the second one within the window actually quits.
      if (this.world.match.phase === "matchEnd" || this.quitArmed) {
        this.prevMenuDown = true;
        this.scene.start("Flow");
        return;
      }
      this.armQuit();
    }
    this.prevMenuDown = mDown;

    const raw = this.reader.read();
    if (import.meta.env.DEV) {
      raw[0] = { ...raw[0], ...this.testHoldP1 };
      raw[1] = { ...raw[1], ...this.testHoldP2 };
    }
    const inputs: [InputSnapshot, InputSnapshot] = [this.latch.apply(0, raw[0]), this.latch.apply(1, raw[1])];
    this.world.advance(delta / 1000, inputs, this.cpu);
    // Clear only the edges the sim ACTED on — an attack pressed while locked in a move/stun stays
    // buffered until the fighter can act, so a light→heavy no longer drops the heavy. (The CPU never
    // touches the latch; consuming its index is a harmless no-op.)
    this.latch.consume(0, this.world.consumedInputs[0]);
    this.latch.consume(1, this.world.consumedInputs[1]);
    // A round ending under an armed prompt closes the window too: ROUND_END_TICKS is itself 2s, so
    // otherwise the prompt can sit through the whole pause and answer for the NEXT round.
    if (this.world.match.phase !== this.prevPhase) {
      if (this.quitArmed) this.disarmQuit();
      this.prevPhase = this.world.match.phase;
    }
    this.applyHitFeedback(this.world.drainEvents());

    const rDown = this.restartKey.isDown;
    if (rDown && !this.prevRestartDown) {
      this.world.restart(); // resets the CPU controller too, via the CpuSeam — see world.resetRound
      this.disarmQuit();
      this.latch.clear();
      for (const s of this.sprites) s.clearFx();
    }
    this.prevRestartDown = rDown;

    this.render();
    // Follow-camera: centre on the fighters' midpoint; setBounds clamps scrollX. No zoom needed —
    // the sim caps the pair at MAX_SEPARATION (< VIEW_WIDTH), so both always fit the viewport.
    const [f0, f1] = this.world.fighters;
    this.cameras.main.centerOnX((f0.x + f1.x) / 2);
    this.hud.update(this.world, time);
  }

  /**
   * Camera juice from the sim's drained event batch (render-only; never feeds the sim).
   * Aggregate the batch to one effect: a KO (whether or not the same batch also carries the hit
   * that caused it) wins via the if/else. `force=true` on both is the load-bearing part — a shake
   * started in an EARLIER update is still running (its window spans several frames), so a fresh hit
   * or a KO must restart it, not be dropped by Shake.start's `if (!force && isRunning)` guard
   * (Shake.js). Trigger on hit *presence*, not damage>0, so a valid 0-damage hit still shakes.
   */
  private applyHitFeedback(events: SimEvent[]): void {
    let ko = false;
    let sawHit = false;
    let sawBlock = false;
    let maxDamage = 0;
    for (const e of events) {
      if (e.type === "ko") ko = true;
      else if (e.type === "hit") { sawHit = true; maxDamage = Math.max(maxDamage, Number(e.data?.damage ?? 0)); }
      else if (e.type === "block") {
        sawBlock = true;
        // Flash the fighter who blocked. The tint must be set THROUGH the sprite (it owns the only
        // write to tint, applied in its update() below) — tinting here would be overwritten instantly.
        if (e.player !== undefined) this.sprites[e.player].flashBlock();
      }
    }
    const cam = this.cameras.main;
    if (ko) {
      cam.flash(KO_FLASH_MS, 255, 255, 255);
      cam.shake(KO_SHAKE_MS, KO_SHAKE_INTENSITY, true);
    } else if (sawHit) {
      const intensity = Phaser.Math.Clamp(HIT_SHAKE_BASE + maxDamage * HIT_SHAKE_PER_DMG, 0, HIT_SHAKE_MAX);
      cam.shake(HIT_SHAKE_MS, intensity, true);
    } else if (sawBlock) {
      cam.shake(BLOCK_SHAKE_MS, BLOCK_SHAKE_INTENSITY, true);
    }
  }

  private render(): void {
    this.debugG.clear();
    const [a, b] = this.world.fighters;
    const frozen = this.world.hitstop > 0;
    this.sprites[0].update(a, this.world.frontIndex === 0, frozen);
    this.sprites[1].update(b, this.world.frontIndex === 1, frozen);
    if (this.debug) {
      drawDebugBoxes(this.debugG, a, this.bounds);
      drawDebugBoxes(this.debugG, b, this.bounds);
    }
  }
}
