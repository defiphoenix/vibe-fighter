import * as Phaser from "phaser";
import { World } from "../sim/world";
import { STAGE_WIDTH, STAGE_HEIGHT, VIEW_WIDTH } from "../sim/constants";
import { liveWidth } from "../render/viewport";
import { groupZoom, stepZoom } from "../render/camera-frame";
import { EdgeLatch, InputReader } from "./input";
import { drawDebugBoxes, allBounds, BOUND_KINDS, type BoundsToggles } from "../render/boxes";
import { CpuController, DAMAGE_SCALE } from "../sim/cpu";
import type { Difficulty } from "../sim/cpu";
import type { MatchConfig } from "./flow-state";
import type { MatchPhase } from "../sim/match";
import { Hud } from "../render/hud";
import { CutInView } from "../render/cutin-view";
import { TouchPad } from "../render/touch-view";
import { touchMode } from "../render/touch";
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

// Match-end menu. Palette + motion borrowed from FlowScene so the two screens read as one product.
const END_OPTIONS = ["REMATCH", "MAIN MENU"] as const;
const END_ACCENT = 0xfd9146; // DUSK_ORANGE
const END_DIM = "#c9b8d4";
const END_MOVE_MS = 120;

export class MatchScene extends Phaser.Scene {
  private world!: World;
  private reader!: InputReader;
  /** DEV only. The whole box overlay — Graphics, keys and draw calls — does not exist in a production
   *  build: `B` used to toggle real hit boxes on the deployed game, and `addKey` captures by default,
   *  so it also swallowed `B`/`1`-`4` from the page for no reason. */
  private debugG?: Phaser.GameObjects.Graphics;
  private sprites!: [FighterSprite, FighterSprite];
  private hud!: Hud;
  private cutIn!: CutInView;
  /** Phase 18: the on-screen pad, built only on a touch-primary device. */
  private pad?: TouchPad;
  private menuBtn?: Phaser.GameObjects.Text;
  /** Consecutive hits each fighter has TAKEN without leaving hitstun. Index = the one being hit. */
  private combo: [number, number] = [0, 0];
  private cfg: MatchConfig = DEFAULT_CONFIG;
  private cpu?: CpuController;
  // Debug bounds default OFF in the shipped match (the Playground defaults them on — that's a
  // tuning tool). `debug` gates the whole overlay; `bounds` picks which kinds it draws.
  private debug = false;
  private bounds: BoundsToggles = allBounds(true);
  private debugKey?: Phaser.Input.Keyboard.Key;
  private restartKey!: Phaser.Input.Keyboard.Key;
  private menuKey!: Phaser.Input.Keyboard.Key;
  private boundKeys: Phaser.Input.Keyboard.Key[] = [];
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
  // Group camera: eased zoom held across frames (render-only, never feeds the sim).
  private zoom = 1;
  /** Screen-space camera. The HUD can't just ride cameras.main with setScrollFactor(0) any more —
   *  scroll factor exempts an object from SCROLL, not from ZOOM, so at ZOOM_MAX the bars would grow
   *  25% and the outer ones would leave the screen. */
  private uiCam!: Phaser.Cameras.Scene2D.Camera;
  /** Live game width — see render/viewport.ts. Written only by `layout()`. */
  private viewW = VIEW_WIDTH;
  private legend!: Phaser.GameObjects.Text;
  // Match-end menu (scene-local: a UI selection is not simulation state).
  private endSel: 0 | 1 = 0;
  private endShown = false;
  private endScrim!: Phaser.GameObjects.Rectangle;
  private endTexts!: Phaser.GameObjects.Text[];
  private endUnderline!: Phaser.GameObjects.Graphics;
  private endTween?: Phaser.Tweens.Tween;
  private endKeys!: { up: Phaser.Input.Keyboard.Key[]; down: Phaser.Input.Keyboard.Key[] };
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
    this.pad = undefined;
    this.menuBtn = undefined;
    this.latch = new EdgeLatch();
    this.testHoldP1 = {};
    this.testHoldP2 = {};
    this.prevDebugDown = false;
    this.prevRestartDown = false;
    this.prevMenuDown = false;
    this.quitArmed = false;
    this.quitTimer = undefined;
    this.prevPhase = "intro";
    this.zoom = 1;
    this.endSel = 0;
    this.endShown = false;
    this.endTween = undefined;
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
        __endMenu: () => { shown: boolean; sel: number };
        __hud: () => ReturnType<Hud["snapshot"]>;
        __cutIn: () => ReturnType<CutInView["snapshot"]>;
        __combo: () => [number, number];
      };
      w.__world = this.world;
      w.__quitArmed = () => this.quitArmed;
      w.__endMenu = () => ({ shown: this.endShown, sel: this.endSel });
      // Lazy on purpose: the HUD is built further down create(), and a spec can only call this once
      // the scene is running anyway.
      w.__hud = () => this.hud.snapshot();
      w.__cutIn = () => this.cutIn.snapshot();
      w.__combo = () => [...this.combo] as [number, number];
      w.__holdP1 = (v) => { this.testHoldP1 = v ?? {}; };
      w.__holdP2 = (v) => { this.testHoldP2 = v ?? {}; };
      // Drop the hooks with the scene. Since Esc returns to the flow, a surviving `__world` is a
      // STOPPED match still answering questions while the menu is up — and the hold closures would
      // write into a dead scene's fields.
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        const g = window as unknown as Record<string, unknown>;
        for (const k of ["__world", "__holdP1", "__holdP2", "__sprites", "__stage", "__quitArmed", "__endMenu", "__hud", "__cutIn", "__combo"]) delete g[k];
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

    if (import.meta.env.DEV) this.debugG = this.add.graphics().setDepth(50);
    this.hud = new Hud(this, [idA, idB]);
    this.cutIn = new CutInView(this);

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
    this.restartKey = kb.addKey(KC.ENTER);
    this.menuKey = kb.addKey(KC.ESC);
    if (import.meta.env.DEV) {
      this.debugKey = kb.addKey(KC.B);
      // 1-4 pick which bound kinds the overlay draws, same order as BOUND_KINDS (hurt/hit/push/guard);
      // B still toggles the overlay itself.
      this.boundKeys = [KC.ONE, KC.TWO, KC.THREE, KC.FOUR].map((k) => kb.addKey(k));
    }
    // Match-end menu navigation. Both players' up/down bindings work — whoever won should not have
    // to reach across the keyboard. These keys are also P1 jump/crouch and P2 jump/crouch, which is
    // harmless: a matchEnd tick consumes no input at all.
    this.endKeys = {
      up: [kb.addKey(KC.UP), kb.addKey(KC.W)],
      down: [kb.addKey(KC.DOWN), kb.addKey(KC.S)],
    };

    // On-screen control legend: one compact line in the bottom strip (below the feet line so it
    // never covers the fighters). White + thin outline for legibility over the busy stage; surfaces
    // the non-obvious keys — crouch = hold down, block = a dedicated key (P1 Q, P2 /), and low/air
    // attacks come from attacking while crouching / airborne.
    this.legend = this.add
      .text(
        VIEW_WIDTH / 2,
        STAGE_HEIGHT - 6,
        // Two lines: as one it measured 1535px against a 1280 viewport, so ~128px fell off each
        // end — including the P1 bindings. Measured, not eyeballed; it had been clipped for phases.
        // The box overlay is DEV-only, so the shipped string must not advertise it.
        "P1 A/D·W·S·Q block·F/G·E super   |   P2 ←→·↑·↓·/ block·,/.·M super   |   "
          + (import.meta.env.DEV ? "B hitboxes · 1-4 kinds · " : "")
          + "Esc menu\n"
          + "CROUCH attacks are LOWS: block CROUCHING   ·   SUPER needs a full meter and spends all of it",
        { fontFamily: "monospace", fontSize: "14px", color: "#ffffff", stroke: "#000000", strokeThickness: 3, align: "center" },
      )
      .setOrigin(0.5, 1)
      .setDepth(101)
      .setScrollFactor(0)
      // On a phone this legend names keys that do not exist, and it sits exactly where the pad's
      // bottom row goes. The pad's own labels are the legend there.
      .setVisible(!touchMode());

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

    this.buildEndMenu();

    // Phase 18: the on-screen pad and the one control Esc has no touch equivalent for. Built here,
    // BEFORE the camera block, so their objects can go into the ignore list below.
    if (touchMode()) {
      this.pad = new TouchPad(this);
      // Bottom CENTRE, in the strip the keyboard legend just vacated — not the top corner, which is
      // where the P2 portrait plate lives (measured off a phone screenshot: the two overlapped). It
      // also sits between the two thumb clusters, so it is visible without being under a thumb.
      this.menuBtn = this.add
        .text(VIEW_WIDTH / 2, STAGE_HEIGHT - 10, "⎋ MENU", {
          fontFamily: "monospace", fontSize: "20px", color: "#ffffff", stroke: "#000000", strokeThickness: 4,
          backgroundColor: "#120a1cb0", padding: { x: 14, y: 8 },
        })
        .setOrigin(0.5, 1)
        .setDepth(97)
        .setScrollFactor(0)
        .setInteractive({ useHandCursor: true })
        // The SAME arm-then-confirm path Esc takes — two taps mid-fight, one when the match is over.
        // A one-tap quit here would throw away a match on a mis-tap, which is worse on a phone than
        // on a keyboard because the button is where a thumb already rests.
        .on("pointerup", () => this.pressMenu());
    }

    // --- Cameras. MUST be last: Phaser starts every Game Object with cameraFilter 0 ("render on
    // every camera") and ignore() only sets one camera's bit, so anything created after this and
    // left out of BOTH lists draws twice, once at world zoom and once at 1:1. The two lists below
    // must therefore stay exhaustive and disjoint; e2e/camera-group.spec.ts asserts exactly that.
    // Sized from the LIVE scale, never the VIEW_WIDTH constant. `CameraManager.onResize` only
    // auto-resizes a camera whose dimensions equal the PREVIOUS game size, so a UI camera hardcoded
    // to 1280 after FlowScene has already widened the game never matches and stays 1280 for good —
    // which crops P2's portrait plate and health bar clean off a phone screen. `layout()` keeps it
    // right afterwards.
    this.uiCam = this.cameras
      .add(0, 0, this.scale.gameSize.width, this.scale.gameSize.height)
      .setName("ui");
    this.uiCam.ignore([
      ...stage.objects,
      ...this.sprites.map((s) => s.sprite),
      ...(this.debugG ? [this.debugG] : []),
    ]);
    this.cameras.main.ignore([
      ...this.hud.objects,
      ...this.cutIn.objects,
      ...(this.pad?.objects ?? []),
      ...(this.menuBtn ? [this.menuBtn] : []),
      this.legend,
      this.quitPrompt,
      this.endScrim,
      this.endUnderline,
      ...this.endTexts,
    ]);
    // Screen-space objects keep setScrollFactor(0) anyway: it is what stage.spec.ts checks, and it
    // keeps them correct if the UI camera ever gains a scroll of its own.

    // The game width follows the device (render/viewport.ts), so every screen-space anchor above is
    // provisional until this runs. The bound property is what makes `off()` work: an inline arrow
    // cannot be removed, and this scene is re-entered on Esc -> Flow -> match and on REMATCH, so a
    // leaked listener would write into a shut-down scene.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onResize);
    });
    this.layout(liveWidth(this.scale.gameSize.width));
  }

  private onResize = (gameSize: Phaser.Structs.Size): void => this.layout(liveWidth(gameSize.width));

  /** Re-anchor every screen-space element to a new game width. */
  private layout(width: number): void {
    this.viewW = width;
    this.uiCam.setSize(width, STAGE_HEIGHT);
    this.hud.layout(width);
    this.cutIn.layout(width);
    this.pad?.layout(width);
    this.legend.setX(width / 2);
    this.quitPrompt.setX(width / 2);
    this.menuBtn?.setX(width / 2);
    this.endScrim.setSize(width, STAGE_HEIGHT);
    for (const t of this.endTexts) t.setX(width / 2);
    // The underline is a Graphics: its rect is baked at draw time, so moving the texts is not enough.
    if (this.endShown) this.paintEndMenu(false);
  }

  /** The match-end choice, built once and hidden. Selection is shown by a caret AND weight, not by
   *  colour alone, so it survives a colour-blind read. */
  private buildEndMenu(): void {
    this.endScrim = this.add
      .rectangle(0, 0, VIEW_WIDTH, STAGE_HEIGHT, 0x000000, 0.5)
      .setOrigin(0, 0)
      // Below the HUD (100/101) so the winner banner stays the brightest thing on screen — it is
      // still a full-screen scrim over the WORLD, because the UI camera renders after the main one.
      .setDepth(99)
      .setScrollFactor(0)
      .setVisible(false);
    this.endUnderline = this.add.graphics().setDepth(103).setScrollFactor(0).setVisible(false);
    this.endTexts = END_OPTIONS.map((label, i) => {
      const t = this.add
        .text(VIEW_WIDTH / 2, 400 + i * 56, label, {
          fontFamily: "monospace",
          fontSize: "32px",
          color: "#ffffff",
          stroke: "#000000",
          strokeThickness: 4,
        })
        .setOrigin(0.5, 0.5)
        .setDepth(103)
        .setScrollFactor(0)
        .setVisible(false);
      // On touch a tap both selects and confirms — there is no second key to press. Phaser does not
      // hit-test an invisible object, so this is inert until the menu is actually up.
      if (touchMode()) {
        t.setInteractive({ useHandCursor: true }).on("pointerup", () => {
          this.endSel = i as 0 | 1;
          this.confirmEndSel();
        });
      }
      return t;
    });
  }

  /** Show/hide the menu. Driven off `match.phase` every frame rather than off the `matchEnd` EVENT:
   *  the event fires once, but the phase is also set directly (the e2e does it, and a rematch
   *  re-enters matchEnd later), and a menu that only ever appeared on the event would miss those. */
  private setEndMenu(show: boolean): void {
    this.endShown = show;
    if (show) this.endSel = 0; // default to REMATCH on every ENTRY, not just in init() — the scene
                               // instance is reused across rematches
    this.endScrim.setVisible(show);
    this.endUnderline.setVisible(show);
    for (const t of this.endTexts) t.setVisible(show);
    if (show) this.paintEndMenu(false);
    else {
      this.endTween?.stop();
      this.endTween = undefined;
      for (const t of this.endTexts) t.setScale(1);
    }
  }

  private paintEndMenu(animate: boolean): void {
    this.endTexts.forEach((t, i) => {
      const on = i === this.endSel;
      t.setText(on ? `▸ ${END_OPTIONS[i]}` : END_OPTIONS[i]);
      t.setColor(on ? "#ffffff" : END_DIM);
      if (!on) t.setScale(1);
    });
    const sel = this.endTexts[this.endSel];
    this.endUnderline.clear();
    // A plate behind the options. The scrim alone is not enough: the winner is usually standing
    // right where these two lines sit, and a 32px glyph over a lit sprite is a busy read.
    const top = this.endTexts[0].y - 30;
    const bottom = this.endTexts[this.endTexts.length - 1].y + 30;
    this.endUnderline.fillStyle(0x000000, 0.62);
    this.endUnderline.fillRect(this.viewW / 2 - 200, top, 400, bottom - top);
    this.endUnderline.fillStyle(END_ACCENT, 1);
    this.endUnderline.fillRect(sel.x - sel.displayWidth / 2, sel.y + 22, sel.displayWidth, 3);
    if (!animate) return;
    // Track and stop THIS tween rather than killTweensOf(target): that would also kill anything
    // else running on the same object (the lesson from Phase 11's permanently-invisible cards).
    this.endTween?.stop();
    sel.setScale(1);
    this.endTween = this.tweens.add({ targets: sel, scale: 1.06, duration: END_MOVE_MS, ease: "Sine.easeOut" });
  }

  private moveEndSel(delta: number): void {
    this.endSel = (((this.endSel + delta) % END_OPTIONS.length) + END_OPTIONS.length) % END_OPTIONS.length as 0 | 1;
    this.paintEndMenu(true);
  }

  /** Act on the highlighted option. REMATCH runs exactly the cleanup the old bare Enter did. */
  private confirmEndSel(): void {
    if (this.endSel === 1) {
      this.scene.start("Flow");
      return;
    }
    this.rematch();
  }

  /** Full restart of the match in place. `latch.clear()` is load-bearing: Arrow-Up doubles as P2's
   *  jump, so navigating this menu leaves a jump edge latched (matchEnd ticks consume nothing) that
   *  would otherwise fire into the first actionable tick of the new match. */
  private rematch(): void {
    this.world.restart(); // resets the CPU controller too, via the CpuSeam — see world.resetRound
    this.disarmQuit();
    this.setEndMenu(false);
    this.latch.clear();
    this.cutIn.stop();
    this.combo = [0, 0];
    for (const s of this.sprites) s.clearFx();
  }

  /**
   * "Leave this match" — the one behaviour behind both the Esc key and the touch MENU button.
   *
   * Nothing left to lose once the match is decided, so leave immediately. Otherwise the first press
   * only ARMS the prompt and the second one within the window actually quits. Returns true when the
   * scene has been started, so the caller can bail out of the rest of its frame.
   */
  private pressMenu(): boolean {
    if (this.world.match.phase === "matchEnd" || this.quitArmed) {
      this.scene.start("Flow");
      return true;
    }
    this.armQuit();
    return false;
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

  /** DEV only — the keys are never bound in a production build, so this is never called there. */
  private updateDebugKeys(): void {
    const dDown = this.debugKey?.isDown ?? false;
    if (dDown && !this.prevDebugDown) this.debug = !this.debug;
    this.prevDebugDown = dDown;

    this.boundKeys.forEach((key, i) => {
      if (Phaser.Input.Keyboard.JustDown(key)) {
        const kind = BOUND_KINDS[i];
        this.bounds = { ...this.bounds, [kind]: !this.bounds[kind] };
        this.debug = true; // toggling a kind with the overlay off is otherwise a silent no-op
      }
    });
  }

  update(time: number, delta: number): void {
    if (import.meta.env.DEV) this.updateDebugKeys();

    const mDown = this.menuKey.isDown;
    if (mDown && !this.prevMenuDown) {
      this.prevMenuDown = true;
      if (this.pressMenu()) return;
    }
    this.prevMenuDown = mDown;

    // The pad is drained exactly ONCE per update, and its held flags are OR'd into P1's keys inside
    // InputReader — before the edge computation, so a tap becomes a rising edge through the same
    // single implementation the keyboard uses. No second route into the sim.
    const raw = this.reader.read(this.pad?.consume());
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

    // Match-end menu: visibility tracks the phase, so a rematch and a directly-set phase both work.
    const atEnd = this.world.match.phase === "matchEnd";
    if (atEnd !== this.endShown) this.setEndMenu(atEnd);
    // The pad goes away with the match: it would otherwise sit under the end menu's scrim, and its
    // bottom-right buttons overlap where a thumb reaches for MAIN MENU. Hiding it also deactivates
    // its listeners, so it cannot swallow that tap.
    this.pad?.setVisible(!atEnd);
    // Menu navigation. Polled on EVERY frame and only ACTED on at matchEnd — never polled inside the
    // `if (atEnd)`. Phaser's `Key._justDown` is set on the keydown event and cleared only when a
    // JustDown() read consumes it or the key comes up; it is NOT frame-scoped. These keys are also
    // jump/crouch, so a player who dies while holding crouch — a very normal way to die — would
    // arrive at the menu carrying an unconsumed edge that fires the instant the menu starts polling,
    // silently moving the highlight off REMATCH before they touch anything. Draining it every frame
    // is the same discipline `prevMenuDown`/`prevRestartDown` and the sim's EdgeLatch already use.
    // At most ONE move per frame, too: two bindings point the same way (ArrowDown and S) and with
    // two options a double step wraps straight back, which reads as the menu ignoring you.
    let step = 0;
    for (const k of this.endKeys.up) if (Phaser.Input.Keyboard.JustDown(k)) step = -1;
    for (const k of this.endKeys.down) if (Phaser.Input.Keyboard.JustDown(k)) step = step === -1 ? 0 : 1;
    if (atEnd && step !== 0) this.moveEndSel(step);

    const rDown = this.restartKey.isDown;
    if (rDown && !this.prevRestartDown) {
      // At matchEnd Enter confirms the highlighted option; everywhere else it stays the bare
      // restart it has always been (which is what the Phase 11 quit-prompt spec presses, in intro).
      this.prevRestartDown = true;
      if (atEnd) { this.confirmEndSel(); return; }
      this.rematch();
    }
    this.prevRestartDown = rDown;

    this.render();
    // Group camera: centre on the fighters' midpoint and zoom IN as they close. Zoom never drops
    // below 1 — the stage art is exactly STAGE_HEIGHT tall, so zooming out would show empty bands
    // (see camera-frame.ts). The view is bottom-aligned: `centerOn`'s y is computed from the CURRENT
    // displayHeight rather than left to clampY, so the intent is in the code and not in the clamp.
    const [f0, f1] = this.world.fighters;
    const cam = this.cameras.main;
    this.zoom = stepZoom(this.zoom, groupZoom(Math.abs(f0.x - f1.x)));
    cam.setZoom(this.zoom);
    cam.centerOn((f0.x + f1.x) / 2, STAGE_HEIGHT - cam.displayHeight / 2);
    this.hud.update(this.world, time);
    // Driven by the sim's freeze countdown, not a tween: it advances under the e2e's pumped step and
    // cannot outlive the freeze it belongs to.
    this.cutIn.update(this.world.hitstop);
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
      else if (e.type === "special") {
        // Arm the cut-in with the freeze the sim just started. Reading world.hitstop rather than the
        // event means the animation is driven by the same countdown that holds the fight still, so
        // the two can never disagree — and a freeze cut short by a KO takes the cut-in with it.
        if (e.player !== undefined) this.cutIn.play(this.world.fighters[e.player].cfg.id, this.world.hitstop);
      } else if (e.type === "hit") {
        sawHit = true;
        maxDamage = Math.max(maxDamage, Number(e.data?.damage ?? 0));
        // Combo count is a PERSISTENT per-defender tally, not a count of this batch: a 15-tick
        // advance can carry several hits, and one flurry spans many batches. It resets when the
        // defender leaves hitstun (below), which is the actual definition of a combo dropping.
        if (e.player !== undefined) this.combo[e.player]++;
      } else if (e.type === "block") {
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
    // Drop the tally the moment the defender can act again. Checked AFTER the events so a hit landing
    // this frame is counted before its own hitstun is read.
    for (const i of [0, 1] as const) {
      if (this.world.fighters[i].state !== "hitstun") this.combo[i] = 0;
    }
  }

  private render(): void {
    const [a, b] = this.world.fighters;
    const frozen = this.world.hitstop > 0;
    this.sprites[0].update(a, this.world.frontIndex === 0, frozen);
    this.sprites[1].update(b, this.world.frontIndex === 1, frozen);
    // `import.meta.env.DEV` folds to `false` in the build, so Rollup drops the whole branch and
    // `drawDebugBoxes` never reaches the production bundle — not even as an unreachable per-frame
    // `clear()` on a Graphics nobody can see.
    if (import.meta.env.DEV && this.debugG) {
      this.debugG.clear();
      if (this.debug) {
        drawDebugBoxes(this.debugG, a, this.bounds);
        drawDebugBoxes(this.debugG, b, this.bounds);
      }
    }
  }
}
