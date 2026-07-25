import * as Phaser from "phaser";
import { World } from "../sim/world";
import { STAGE_WIDTH, STAGE_HEIGHT, ROUND_TIME, TICK_HZ, VIEW_WIDTH } from "../sim/constants";
import { emptyInput } from "../sim/types";
import type { CharacterData, InputSnapshot } from "../sim/types";
import { EdgeLatch, InputReader } from "./input";
import { drawDebugBoxes, allBounds, BOUND_KINDS, type BoundsToggles } from "../render/boxes";
import { Hud } from "../render/hud";
import { CutInView } from "../render/cutin-view";
import { METER_MAX } from "../sim/fighter";
import { buildStage } from "../render/stage";
import type { StagesFile } from "../render/stage";
import { loadRegistry, buildConfig, type CharacterRegistry } from "../render/characters";
import { FighterSprite } from "../render/fighter-sprite";
import {
  checkRow, installFocusGuard, num, numRow, panelCard, row, saveRegistry, select,
} from "../render/dev-panel";

const DUMMY_X = STAGE_WIDTH / 2 + 200;
// Tuning ranges. Upper bounds are not fussiness: a fat-fingered walkSpeed (240 → 24099 by typing on
// the end of the field) tunnels the fighter straight through the dummy's pushbox in one tick, which
// looks like a collision bug rather than a typo. Lower bounds keep the sim/validator happy.
const STAT_RANGE = {
  walkSpeed: [0, 1200],
  jumpVelocity: [0, 3000],
  gravity: [0, 12000],
  maxHealth: [1, 999],
  scale: [0.1, 4],
} as const;
const STAT_KEYS = Object.keys(STAT_RANGE) as (keyof typeof STAT_RANGE)[];
type StatKey = (typeof STAT_KEYS)[number];

/**
 * Dev-only Fighter Playground (?scene=playground). One controllable fighter on the real twilight
 * stage plus an inert dummy, so movement/attacks/blocking can be FELT while the per-character stats
 * are tuned live and saved back to character-gym.json (the same file the match boots from).
 *
 * It drives a real World — the tick order in world.tick() is authoritative and is never
 * re-implemented here. What the playground does change is the match LIFECYCLE, and only in the two
 * safe ways described at pinClock()/resetIfRoundOver().
 */
export class PlaygroundScene extends Phaser.Scene {
  private reg!: CharacterRegistry;
  private rawFile!: Record<string, { render: unknown; data: CharacterData }>;
  private playerId!: string;
  private dummyId!: string;
  private working!: CharacterData; // mutable stats copy for the player
  private world!: World;
  private reader!: InputReader;
  private latch = new EdgeLatch();
  private sprites!: [FighterSprite, FighterSprite];
  private hud!: Hud;
  private cutIn!: CutInView;
  /** Training-dummy toggles (Phase 15). Off by default so the Playground still behaves like a match
   *  until you ask for a dummy: regen keeps the target alive so repeated hits stay comparable, and
   *  the meter fill is what makes the special reachable without farming a bar first. */
  private regenDummy = false;
  private fillMeter = false;
  private debugG!: Phaser.GameObjects.Graphics;
  private bounds: BoundsToggles = allBounds(true);
  private boundInputs: Partial<Record<keyof BoundsToggles | "all", HTMLInputElement>> = {};
  private panel!: HTMLDivElement;
  private status!: HTMLSpanElement;
  private statInputs!: Record<StatKey, HTMLInputElement>;
  private removeFocusGuard?: () => void;
  private hold: Partial<InputSnapshot> = {}; // e2e input seam (see __playground.hold)
  private resets = 0; // how many times the world was re-placed — the sub-tick reset-loop regression

  constructor() {
    super("Playground");
  }

  create(): void {
    this.reg = loadRegistry(this.cache.json);
    this.rawFile = this.cache.json.get("characters");
    const ids = Object.keys(this.reg);
    this.playerId = ids[0];
    this.dummyId = ids[1] ?? ids[0];

    const stages = this.cache.json.get("stages") as StagesFile;
    buildStage(this, stages.twilight);
    this.cameras.main.setBounds(0, 0, STAGE_WIDTH, STAGE_HEIGHT);

    this.debugG = this.add.graphics().setDepth(50);
    this.hud = new Hud(this, [this.playerId, this.dummyId]);
    this.cutIn = new CutInView(this);
    this.reader = new InputReader(this);

    this.add
      .text(
        VIEW_WIDTH / 2,
        STAGE_HEIGHT - 6,
        "Playground — A/D move · W jump · S crouch · Q block · F/G attack (S+F/G = LOW) · E super   |   1-4 bounds · B all · R reset   |   panel: fighter select · regen hp · fill meter",
        { fontFamily: "monospace", fontSize: "14px", color: "#ffffff", stroke: "#000000", strokeThickness: 3 },
      )
      .setOrigin(0.5, 1)
      .setDepth(101)
      .setScrollFactor(0);

    this.buildPanel();
    this.buildWorld();
    this.bindKeys();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) {
      (window as unknown as { __playground: unknown }).__playground = {
        world: () => this.world,
        bounds: () => ({ ...this.bounds }),
        toggleBound: (k: keyof BoundsToggles | "all") => this.toggleBound(k),
        stats: () => ({ ...this.working.stats }),
        setStat: (k: StatKey, v: number) => this.setStat(k, v),
        // Input seam for the acceptance spec, mirroring MatchScene.__holdP1: the values are merged
        // into the P1 snapshot and then travel the REAL adapter path (latch -> world.advance).
        // Deliberately gated by the focus guard in update(), so a test can prove that typing in the
        // panel stops gameplay input rather than merely flipping a flag.
        hold: (v: Partial<InputSnapshot>) => { this.hold = v ?? {}; },
        keyboardEnabled: () => this.input.keyboard?.enabled ?? false,
        spriteScale: () => this.sprites[0].sprite.scaleX,
        reset: () => this.resetWorld(),
        resets: () => this.resets,
        focusPanel: () => this.statInputs.walkSpeed.focus(),
        select: (player: string, dummy?: string) => this.selectFighters(player, dummy),
        // Phase 15 dummy toggles + the cut-in, so a spec can drive them without touching the DOM.
        dummy: (v: { regenHp?: boolean; fillMeter?: boolean }) => {
          if (v.regenHp !== undefined) this.regenDummy = v.regenHp;
          if (v.fillMeter !== undefined) this.fillMeter = v.fillMeter;
        },
        cutIn: () => this.cutIn.snapshot(),
      };
    }
  }

  // --- sim ---------------------------------------------------------------------------------

  /** Keeping the player's x across a rebuild is a convenience, but it must not drop them inside or
   *  past the dummy — restart() re-faces both fighters and the first tick returns before spatial
   *  resolve, so an overlapping pair would render for a frame. Stay a clear body-width to the left. */
  private safeKeepX(x: number): number {
    return Math.min(x, DUMMY_X - 120);
  }

  /** (Re)build the world from the working data, optionally keeping the player where they stood. */
  private buildWorld(keepX?: number): void {
    this.world = new World(
      buildConfig(this.playerId, { render: this.reg[this.playerId].render, data: this.working }),
      buildConfig(this.dummyId, this.reg[this.dummyId]),
    );
    this.world.fighters[1].x = DUMMY_X;
    if (keepX !== undefined) this.world.fighters[0].x = this.safeKeepX(keepX);
    this.latch.clear();
    this.world.drainEvents();

    this.sprites?.forEach((s) => s.destroy());
    this.sprites = [
      new FighterSprite(this, this.playerId, this.reg[this.playerId].render, this.working.stats.scale, this.working),
      new FighterSprite(this, this.dummyId, this.reg[this.dummyId].render, this.reg[this.dummyId].data.stats.scale, this.reg[this.dummyId].data),
    ];
  }

  /** Keep the playground playable without reaching into tick(): hold the round clock full (nothing
   *  but the timeout check reads it) and skip the "Round 1… Fight!" freeze on a FRESH round. Both
   *  only ever touch a round that has not been decided. */
  private pinClock(): void {
    const m = this.world.match;
    m.timerTicks = ROUND_TIME * TICK_HZ;
    if (m.phase === "intro") m.introTicks = 0;
  }

  /** A KO/timeout has already been banked by endRound() — wins incremented, a fighter left in `ko`.
   *  Forcing phase back to "fight" would re-bank the same KO every tick until matchWinner is set, so
   *  restart the whole thing instead (the one path that resets wins/winner/fighters/hitstop).
   *
   *  Match ONLY the two DECIDED phases — never `!== "fight"`. `restart()` leaves the world in
   *  `intro`, which pinClock clears on the next tick; but a frame whose delta is under one tick
   *  (routine at 120 Hz, or any short frame) runs ZERO ticks, so the phase would still read `intro`
   *  here and trigger another restart — an every-frame reset loop that teleports the fighter back to
   *  spawn and clears the input latch, silently swallowing whatever you just pressed. */
  private resetIfRoundOver(): void {
    const phase = this.world.match.phase;
    if (phase !== "roundEnd" && phase !== "matchEnd") return;
    this.resetWorld(); // full clean re-place — a KO reset should look like a reset, not a teleport
  }

  private resetWorld(keepX?: number): void {
    this.resets++;
    // A training scene must not confiscate the bar you just farmed. `World.restart()` zeroing the
    // meter is right for a fresh MATCH, but every restart here is bookkeeping — the KO cleanup above,
    // or the R key — and the whole point of the scene is to try a super repeatedly. Losing the meter
    // on each KO makes a special you have to build meter for effectively untestable.
    const meters = this.world.fighters.map((f) => f.meter);
    this.world.restart();
    this.world.fighters.forEach((f, i) => { f.meter = meters[i]; });
    this.world.fighters[1].x = DUMMY_X;
    if (keepX !== undefined) this.world.fighters[0].x = this.safeKeepX(keepX);
    this.latch.clear();
    this.world.drainEvents();
  }

  update(time: number, delta: number): void {
    this.pinClock();

    // The focus guard disables the keyboard while a panel field has focus; feed the sim nothing at
    // all in that window so the seam can't drive the fighter either.
    const typing = !(this.input.keyboard?.enabled ?? true);
    const raw = this.reader.read();
    const p1: InputSnapshot = typing ? emptyInput() : { ...raw[0], ...this.hold };
    const inputs: [InputSnapshot, InputSnapshot] = [this.latch.apply(0, p1), emptyInput()];

    // Training-dummy helpers, applied BEFORE the advance. After is too late: health reaching 0 sets
    // `ko` and flips the match to roundEnd inside that same advance, and resetIfRoundOver() below
    // fires immediately after — restoring health then cannot undo the KO. Before is also sufficient,
    // not merely necessary: an advance batch is at most 15 ticks and the biggest single hit on the
    // roster is 15 damage, so a dummy starting every frame at full health cannot be brought to 0
    // inside one batch.
    const dummy = this.world.fighters[1];
    if (this.regenDummy) dummy.health = dummy.cfg.stats.maxHealth;
    if (this.fillMeter) this.world.fighters[0].meter = METER_MAX;

    this.world.advance(delta / 1000, inputs);
    // Clear only the edges the sim ACTED on, so an attack pressed while the fighter is locked in a
    // move/stun stays buffered until it can come out (a light→heavy no longer drops the heavy).
    this.latch.consume(0, this.world.consumedInputs[0]);
    // No camera juice here, but the special's cut-in DOES belong in the Playground — the dummy is
    // where you try the move. (World also accumulates events until something drains them.)
    for (const e of this.world.drainEvents()) {
      if (e.type === "special" && e.player !== undefined) {
        this.cutIn.play(this.world.fighters[e.player].cfg.id, this.world.hitstop);
      }
    }
    this.resetIfRoundOver();

    this.render();
    this.cameras.main.centerOnX(this.world.fighters[0].x);
    this.hud.update(this.world, time);
    this.cutIn.update(this.world.hitstop);
  }

  private render(): void {
    const [p, d] = this.world.fighters;
    const frozen = this.world.hitstop > 0;
    this.sprites[0].update(p, this.world.frontIndex === 0, frozen);
    this.sprites[1].update(d, this.world.frontIndex === 1, frozen);
    this.debugG.clear();
    drawDebugBoxes(this.debugG, p, this.bounds);
    drawDebugBoxes(this.debugG, d, this.bounds);
  }

  // --- controls ----------------------------------------------------------------------------

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    kb.on("keydown-ONE", () => this.toggleBound("hurt"));
    kb.on("keydown-TWO", () => this.toggleBound("hit"));
    kb.on("keydown-THREE", () => this.toggleBound("push"));
    kb.on("keydown-FOUR", () => this.toggleBound("guard"));
    kb.on("keydown-B", () => this.toggleBound("all"));
    kb.on("keydown-R", () => this.resetWorld());
  }

  /** "all" flips every bound to the opposite of "are they all on right now". */
  private toggleBound(k: keyof BoundsToggles | "all"): void {
    if (k === "all") this.bounds = allBounds(!BOUND_KINDS.every((b) => this.bounds[b]));
    else this.bounds = { ...this.bounds, [k]: !this.bounds[k] };
    this.syncBoundInputs();
  }

  private setStat(k: StatKey, v: number): void {
    if (!Number.isFinite(v)) return;
    const [lo, hi] = STAT_RANGE[k];
    const clamped = Math.min(hi, Math.max(lo, v));
    this.working.stats[k] = clamped;
    this.buildWorld(this.world.fighters[0].x); // rebuild so the sim config really carries the change
    // Only correct the field when the value was actually clamped — rewriting it on every keystroke
    // would fight the caret while typing.
    if (clamped !== v) this.statInputs[k].value = String(clamped);
  }

  private selectFighters(player: string, dummy?: string): void {
    const changedPlayer = this.reg[player] !== undefined && player !== this.playerId;
    if (this.reg[player]) this.playerId = player;
    if (dummy && this.reg[dummy]) this.dummyId = dummy;
    // Only re-read the working copy when the PLAYER changed. Re-reading on a dummy swap silently
    // threw away every unsaved stat edit — the panel kept showing them because syncStatInputs then
    // rewrote the fields from the registry.
    if (changedPlayer) {
      this.working = JSON.parse(JSON.stringify(this.reg[this.playerId].data)) as CharacterData;
      this.syncStatInputs();
    }
    this.buildWorld();
  }

  // --- DOM panel (built in-scene: a production build never registers this scene) --------------

  private buildPanel(): void {
    // pushed below the HUD: the P2/dummy health bar lives at the canvas top-right and watching it
    // drain is half the point of hitting the dummy.
    const panel = panelCard("playground-panel", "Fighter Playground", "96px");
    const ids = Object.keys(this.reg);
    const playerSel = select(ids, (v) => this.selectFighters(v));
    const dummySel = select(ids, (v) => this.selectFighters(this.playerId, v));
    playerSel.value = this.playerId;
    dummySel.value = this.dummyId;
    panel.append(row("player", playerSel), row("dummy", dummySel));

    this.working = JSON.parse(JSON.stringify(this.reg[this.playerId].data)) as CharacterData;
    this.statInputs = {} as Record<StatKey, HTMLInputElement>;
    for (const k of STAT_KEYS) {
      const input = numRow(panel, k);
      const [lo, hi] = STAT_RANGE[k];
      input.step = k === "scale" ? "0.05" : "10";
      input.min = String(lo);
      input.max = String(hi);
      input.addEventListener("input", () => this.setStat(k, num(input.value, this.working.stats[k])));
      this.statInputs[k] = input;
    }
    this.syncStatInputs();

    const boundsHead = document.createElement("div");
    boundsHead.textContent = "bounds";
    boundsHead.style.cssText = "margin:8px 0 4px;color:#8fa";
    panel.append(boundsHead);
    for (const k of BOUND_KINDS) {
      this.boundInputs[k] = checkRow(panel, k, (on) => {
        this.bounds = { ...this.bounds, [k]: on };
        this.syncBoundInputs();
      });
    }
    this.boundInputs.all = checkRow(panel, "all", () => this.toggleBound("all"));
    this.syncBoundInputs();

    const dummyHead = document.createElement("div");
    dummyHead.textContent = "training dummy";
    dummyHead.style.cssText = "margin:8px 0 4px;color:#8fa";
    panel.append(dummyHead);
    // Regen makes the impact of successive attacks comparable (the bar always starts full), and the
    // meter fill is what makes the special reachable without farming a bar first.
    checkRow(panel, "regen hp", (on) => { this.regenDummy = on; });
    checkRow(panel, "fill meter", (on) => { this.fillMeter = on; });

    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save JSON";
    saveBtn.style.cssText = "margin-top:8px;width:100%;padding:6px;cursor:pointer";
    saveBtn.addEventListener("click", () => this.save());
    this.status = document.createElement("span");
    this.status.style.cssText = "display:block;margin-top:6px;color:#8fa";
    panel.append(saveBtn, this.status);

    document.body.appendChild(panel);
    this.panel = panel;
    this.removeFocusGuard = installFocusGuard(this, panel);
  }

  private syncStatInputs(): void {
    for (const k of STAT_KEYS) this.statInputs[k].value = String(this.working.stats[k]);
  }

  private syncBoundInputs(): void {
    for (const k of BOUND_KINDS) {
      const el = this.boundInputs[k];
      if (el) el.checked = this.bounds[k];
    }
    if (this.boundInputs.all) this.boundInputs.all.checked = BOUND_KINDS.every((b) => this.bounds[b]);
  }

  /** Only stats are edited here, so write just those back — box overrides stay whatever the Gym set. */
  private async save(): Promise<void> {
    this.rawFile[this.playerId].data.stats = { ...this.working.stats };
    const res = await saveRegistry(this.rawFile);
    this.status.textContent = res.ok ? "saved ✓" : `error: ${res.error}`;
    this.status.style.color = res.ok ? "#8fa" : "#f88";
  }

  private teardown(): void {
    this.removeFocusGuard?.();
    this.panel?.remove();
    this.input.removeAllListeners();
    this.input.keyboard?.removeAllListeners();
  }
}
