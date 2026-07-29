import * as Phaser from "phaser";
import { VIEW_WIDTH, STAGE_HEIGHT } from "../sim/constants";
import { loadRegistry } from "../render/characters";
import type { StagesFile } from "../render/stage";
import {
  SELECTABLE_IDS, advance, back, bothLocked, characterCardWidth, cpuPick, initialFlow,
  isCpu, lock, modeOptions, moveChar, moveMenu, setChar, toMatchConfig,
} from "./flow-state";
import type { FlowState, MatchConfig, Player } from "./flow-state";
import { makeRoll } from "./roll";
import { touchMode } from "../render/touch";

// Rooftop-dusk palette, sampled from the locked Phase 03 mockup and baked into the Phase 06
// portraits. The menus share it deliberately: a card screen in a different palette from the
// portraits it displays reads as two different products.
const DUSK_VIOLET = 0x5e3c74;
const DUSK_ROSE = 0x8c476a;
const DUSK_ORANGE = 0xfd9146;
const P1_BLUE = 0x66ccff;
const P2_RED = 0xff8866;

const CSS = { orange: "#fd9146", white: "#ffffff", dim: "#c9b8d4" };
const FONT = "monospace";

// Motion: "energetic" — 100-250ms, ease-out. Entry stagger stays under 200ms total.
const MOVE_MS = 120;
const FLASH_MS = 160; // x2 with yoyo => ~320ms per lock-in
const STAGGER_MS = 40;
const CPU_THINK_MS = 260; // the deliberate beat before the CPU reveals its pick

interface Card {
  root: Phaser.GameObjects.Container;
  art?: Phaser.GameObjects.Image;
  frame: Phaser.GameObjects.Graphics;
  w: number;
  h: number;
  /** the selection SCALE tween only — tracked so a repaint can replace it without touching the
   *  entry fade, which shares the same target and would otherwise be killed mid-way, leaving the
   *  card stuck at alpha 0 (i.e. invisible). */
  scaleTween?: Phaser.Tweens.Tween;
}

/**
 * The Play flow: title -> mode (1v1 / CPU easy|normal|hard) -> stage -> characters -> match.
 *
 * All the branching rules live in the Phaser-free `flow-state.ts` (unit-tested in the node env);
 * this scene is the adapter — it draws the current step and turns key presses into transitions.
 * Every key goes through `press()`, which is also the DEV `window.__flow.press` seam, so the e2e
 * spec drives the real handlers rather than poking state.
 */
export class FlowScene extends Phaser.Scene {
  private state!: FlowState;
  private stageIds: string[] = [];
  private roster: string[] = [];
  private layer!: Phaser.GameObjects.Container; // everything belonging to the current step
  private cards: Card[] = [];
  private tags: Phaser.GameObjects.Text[] = []; // per-repaint P1/P2 labels, destroyed and redrawn
  private keys!: Record<string, Phaser.Input.Keyboard.Key>;
  private busy = false; // true only during the CPU's think-and-reveal beat: swallow input
  private starting = false; // guards the queued scene.start against a second caller
  /** The CPU pick's randomness. Seeded from the wall clock in normal play — the render layer may read
   *  a clock, `src/sim/` may not — and replaced wholesale by the DEV `__flow.seed` seam so an e2e can
   *  assert an exact opponent instead of a coin flip. */
  private roll: () => number = makeRoll(1);

  constructor() {
    super("Flow");
  }

  /** State lives here, not in the constructor: the scene is re-entered from a finished match. */
  init(): void {
    this.state = initialFlow(touchMode());
    this.cards = [];
    this.busy = false;
    this.starting = false;
  }

  create(): void {
    const stages = this.cache.json.get("stages") as StagesFile;
    this.stageIds = Object.keys(stages).filter((k) => !k.startsWith("_"));
    const reg = loadRegistry(this.cache.json);
    this.roster = SELECTABLE_IDS.filter((id) => reg[id]);
    if (!this.roster.length) throw new Error("flow: none of the selectable fighters are in the registry");
    if (!this.stageIds.length) throw new Error("flow: stages.json has no stages");

    this.backdrop();
    // Above the backdrop scrim (depth 1). A container's own depth is what sorts it against the
    // scene; the depths its children carry are only relative to each other, so leaving this at the
    // default 0 draws the entire menu UNDER the scrim and dims every card, portrait and label.
    this.layer = this.add.container(0, 0).setDepth(5);
    this.bindKeys();
    this.build();

    // A fresh stream per visit to the flow, so a rematch-then-menu-then-CPU-match does not replay the
    // previous pick. Safe to read a clock here: this is the render layer, not the sim.
    this.roll = makeRoll(Date.now() & 0x7fffffff);

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());

    if (import.meta.env.DEV) {
      (window as unknown as { __flow: unknown }).__flow = {
        state: () => ({ ...this.state, cursors: [...this.state.cursors], locked: [...this.state.locked] }),
        press: (key: string) => this.press(key),
        roster: () => [...this.roster],
        stages: () => [...this.stageIds],
        // What the mode screen ACTUALLY offers. A spec asserting "no local PvP on a phone" has to
        // read the offered list, not hope that a constant it imports is the one being drawn.
        modes: () => modeOptions(this.state.touch).map((m) => m.label),
        // Card geometry in GAME space, so a spec can tap the real thing at real coordinates instead
        // of calling the handler directly — a seam-driven tap cannot see a broken hit area.
        cards: () => this.cards.map((c) => ({ x: c.root.x, y: c.root.y, w: c.w, h: c.h, alpha: c.root.alpha })),
        // Pin the CPU's pick. A spec that asserts an exact opponent MUST call this — otherwise it is
        // right about half the time, which is an intermittently-red suite rather than a test.
        seed: (n: number) => { this.roll = makeRoll(n); },
      };
    }
  }

  // --- chrome ------------------------------------------------------------------------------

  /** The real stage layers under a scrim, so the menu sits in the game's world, not on a panel. */
  private backdrop(): void {
    for (const key of ["twilight-far", "twilight-medium"]) {
      if (this.textures.exists(key)) this.add.image(0, 0, key).setOrigin(0, 0).setScrollFactor(0).setDepth(0);
    }
    this.add.rectangle(0, 0, VIEW_WIDTH, STAGE_HEIGHT, 0x120a1c, 0.72).setOrigin(0, 0).setDepth(1);
    this.add.rectangle(0, STAGE_HEIGHT - 4, VIEW_WIDTH, 4, DUSK_ORANGE, 0.9).setOrigin(0, 0).setDepth(1);
  }

  private text(
    x: number, y: number, msg: string, size: number, color = CSS.white, origin = 0.5,
  ): Phaser.GameObjects.Text {
    return this.add
      .text(x, y, msg, { fontFamily: FONT, fontSize: `${size}px`, color, stroke: "#000000", strokeThickness: size > 30 ? 6 : 3 })
      .setOrigin(origin, 0.5)
      .setDepth(10);
  }

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    const KC = Phaser.Input.Keyboard.KeyCodes;
    // addKey captures by default, which is what stops the arrows scrolling the page.
    this.keys = {
      enter: kb.addKey(KC.ENTER),
      esc: kb.addKey(KC.ESC),
      a: kb.addKey(KC.A),
      d: kb.addKey(KC.D),
      left: kb.addKey(KC.LEFT),
      right: kb.addKey(KC.RIGHT),
      f: kb.addKey(KC.F),
      comma: kb.addKey(KC.COMMA),
    };
    // DEV only: jump to the Fighter Playground from the title. Bound (and captured) only in DEV so a
    // prod build never preventDefaults P for a key with no action.
    if (import.meta.env.DEV) this.keys.p = kb.addKey(KC.P);
  }

  update(): void {
    for (const name of Object.keys(this.keys)) {
      if (Phaser.Input.Keyboard.JustDown(this.keys[name])) this.press(name);
    }
  }

  // --- input -> state ----------------------------------------------------------------------

  /** The one door every key goes through (real keyboard and the DEV e2e seam alike). */
  press(key: string): void {
    if (this.busy) return;
    const before = this.state;
    const s = this.state;

    if (key === "esc") {
      this.state = back(s);
      return this.rebuildIf(before);
    }

    if (s.step === "title") {
      if (import.meta.env.DEV && key === "p") return this.startPlayground();
      if (key === "enter") this.state = advance(s);
      return this.rebuildIf(before);
    }

    if (s.step === "mode" || s.step === "stage") {
      const count = s.step === "stage" ? this.stageIds.length : modeOptions(s.touch).length;
      if (key === "a" || key === "left") this.state = moveMenu(s, -1, count);
      else if (key === "d" || key === "right") this.state = moveMenu(s, 1, count);
      else if (key === "enter" || key === "f") this.state = advance(s);
      return this.rebuildIf(before);
    }

    // chars: P1 = A/D + F, P2 = arrows + comma. Enter locks P1 only in CPU mode, where there is no
    // second player to make it ambiguous.
    const n = this.roster.length;
    if (key === "a") this.state = moveChar(s, 0, -1, n);
    else if (key === "d") this.state = moveChar(s, 0, 1, n);
    else if (key === "left" && !isCpu(s)) this.state = moveChar(s, 1, -1, n);
    else if (key === "right" && !isCpu(s)) this.state = moveChar(s, 1, 1, n);
    else if (key === "f" || (key === "enter" && isCpu(s))) return this.doLock(0);
    else if (key === "comma" && !isCpu(s)) return this.doLock(1);
    this.rebuildIf(before);
  }

  /**
   * Lock one player's pick, flash their card, and start the match once both are in.
   *
   * The flash deliberately does NOT block input: it lasts ~320ms and in 1v1 both players are pressing
   * at once, so swallowing keys for its duration eats P2's lock whenever they answer quickly. Only
   * the CPU's think-and-reveal beat sets `busy`, because there is genuinely nothing to press then.
   */
  private doLock(player: Player): void {
    if (this.state.locked[player]) return;
    this.state = lock(this.state, player);
    const cursor = this.state.cursors[player];
    this.paint();
    this.flash(cursor, () => {
      if (isCpu(this.state)) {
        if (!this.state.locked[0]) return; // they un-locked during the flash
        this.busy = true;
        this.time.delayedCall(CPU_THINK_MS, () => {
          this.state = cpuPick(this.state, this.roster.length, this.roll());
          this.paint();
          this.flash(this.state.cursors[1], () => this.startMatch());
        });
        return;
      }
      if (bothLocked(this.state)) this.startMatch();
    });
  }

  /** Best effort, and deliberately silent. iPhone Safari still has no fullscreen for an arbitrary
   *  element (Phaser answers FULLSCREEN_UNSUPPORTED and carries on), Android may refuse, and neither
   *  is a reason to interrupt someone who just wanted to start a game. The letterboxed layout is
   *  correct either way — fullscreen only makes it bigger. */
  private requestFullscreen(): void {
    try {
      if (!this.scale.isFullscreen) this.scale.startFullscreen();
    } catch {
      /* refused: play windowed */
    }
  }

  private startMatch(): void {
    // Both players' flash callbacks land ~320ms after their own lock, and BOTH see `bothLocked`
    // once the second one is in — so this is reachable twice for a single match. scene.start is
    // queued, so the second call would fire while the flow is already tearing down.
    if (this.starting) return;
    this.starting = true;
    const cfg: MatchConfig = toMatchConfig(this.state, this.roster, this.stageIds);
    this.scene.start("Match", cfg);
  }

  /** DEV: the ONE guarded door to the Playground, for both the P key and the button's pointerdown.
   *  scene.start is queued, so a same-frame key+click would otherwise start it twice. */
  private startPlayground(): void {
    if (this.starting) return;
    this.starting = true;
    this.scene.start("Playground");
  }

  /** Rebuild only when the step changed; otherwise just repaint cursors/locks. */
  private rebuildIf(before: FlowState): void {
    if (before === this.state) return;
    if (before.step !== this.state.step) this.build();
    else this.paint();
  }

  // --- drawing -----------------------------------------------------------------------------

  private build(): void {
    this.tweens.killTweensOf(this.cards.map((c) => c.root));
    this.layer.removeAll(true); // destroys the previous step's objects, tags included
    this.cards = [];
    this.tags = [];

    const touch = this.state.touch;
    if (this.state.step === "title") this.buildTitle();
    else if (this.state.step === "mode") {
      this.buildRow(
        modeOptions(touch).map((m) => m.label), 250, 130, "MODE",
        touch ? "TAP a card · TAP again to confirm" : "← → choose · ENTER confirm",
      );
    } else if (this.state.step === "stage") this.buildStages();
    else this.buildChars();

    // One BACK button, drawn for every step past the title. On a phone there is no Esc key, so
    // without it a wrong tap on the mode screen is a dead end that needs a page reload.
    if (touch && this.state.step !== "title") {
      const backBtn = this.text(90, 44, "◀ BACK", 22, CSS.dim)
        .setInteractive({ useHandCursor: true })
        .on("pointerup", () => this.press("esc"));
      this.layer.add(backBtn);
    }

    this.paint();
  }

  /**
   * What a TAP on card `i` means. One rule for every screen, so there is nothing to learn:
   * **an unselected card selects; the selected card confirms.**
   *
   * Routed through `press()` and the pure state functions rather than poking `this.state`, so the tap
   * path and the key path cannot diverge — and `rebuildIf` still owns the redraw.
   *
   * `pointerup`, not `pointerdown`: on the title screen the same gesture asks for fullscreen, and a
   * fullscreen request from `pointerdown` is refused on touch devices.
   */
  private tapCard(i: number): void {
    if (this.busy) return;
    const s = this.state;
    if (s.step === "mode" || s.step === "stage") {
      const cur = s.step === "mode" ? s.modeIndex : s.stageIndex;
      if (cur === i) return this.press("enter");
      this.state = s.step === "mode" ? { ...s, modeIndex: i } : { ...s, stageIndex: i };
      return this.rebuildIf(s);
    }
    if (s.step !== "chars") return;
    if (s.cursors[0] === i) return this.press("f"); // lock P1 on the card they already hold
    this.state = setChar(s, 0, i, this.roster.length);
    this.rebuildIf(s);
  }

  private buildTitle(): void {
    const t = this.text(VIEW_WIDTH / 2, 250, "VIBE FIGHTER", 82, CSS.orange);
    const sub = this.text(VIEW_WIDTH / 2, 340, "rooftop dusk", 22, CSS.dim);
    const hint = this.text(VIEW_WIDTH / 2, 470, this.state.touch ? "TAP TO START" : "PRESS ENTER", 30);
    this.layer.add([t, sub, hint]);
    if (this.state.touch) {
      // A full-screen Zone rather than a button: the first tap is also the only user gesture we are
      // guaranteed, and it is the one chance to ask for fullscreen. Mobile browsers keep a URL bar in
      // landscape that eats ~15% of a screen this game has no spare pixels on.
      const zone = this.add.zone(0, 0, VIEW_WIDTH, STAGE_HEIGHT).setOrigin(0, 0).setInteractive();
      // pointerUP, not down: a fullscreen request from pointerdown is refused on touch devices.
      zone.on("pointerup", () => {
        this.requestFullscreen();
        this.press("enter");
      });
      this.layer.add(zone);
    }
    this.tweens.add({ targets: hint, alpha: 0.25, duration: 700, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });

    // DEV-only entry to the Phase-10 Fighter Playground (a tuning tool — its stat write-back needs the
    // dev-server middleware, so it never ships). Click or press P. Added to this.layer so the step
    // change destroys it. ponytail: drop the DEV gate to expose the Playground in a shipped build.
    if (import.meta.env.DEV) {
      const pg = this.text(VIEW_WIDTH / 2, 540, "▶ PLAYGROUND (dev)", 20, CSS.dim)
        .setInteractive({ useHandCursor: true })
        .on("pointerdown", () => this.startPlayground());
      this.layer.add(pg);
    }
  }

  /** A row of plain labelled cards (the mode screen). */
  private buildRow(labels: string[], cardW: number, cardH: number, heading: string, hint: string): void {
    this.layer.add(this.text(VIEW_WIDTH / 2, 120, heading, 40, CSS.orange));
    this.layer.add(this.text(VIEW_WIDTH / 2, 620, hint, 18, CSS.dim));
    const gap = 24;
    const total = labels.length * cardW + (labels.length - 1) * gap;
    labels.forEach((label, i) => {
      const x = (VIEW_WIDTH - total) / 2 + i * (cardW + gap) + cardW / 2;
      const card = this.makeCard(x, 340, cardW, cardH);
      const text = this.text(0, 0, label, 22).setOrigin(0.5);
      card.root.add(text);
      this.stagger(card, i);
    });
  }

  private buildStages(): void {
    this.layer.add(this.text(VIEW_WIDTH / 2, 100, "STAGE", 40, CSS.orange));
    this.layer.add(this.text(
      VIEW_WIDTH / 2, 620,
      this.state.touch ? "TAP a stage · TAP again to confirm" : "← → choose · ENTER confirm · ESC back",
      18, CSS.dim,
    ));
    const cardW = 460;
    const cardH = 300;
    const gap = 40;
    const total = this.stageIds.length * cardW + (this.stageIds.length - 1) * gap;
    this.stageIds.forEach((id, i) => {
      const x = (VIEW_WIDTH - total) / 2 + i * (cardW + gap) + cardW / 2;
      const card = this.makeCard(x, 330, cardW, cardH);
      const key = `${id}-main`;
      if (this.textures.exists(key)) {
        // Scale by WIDTH so the pre-baked 1697x720 layer keeps its aspect — the same footgun
        // copy-stage-layers.py exists to avoid at runtime.
        const art = this.add.image(0, -26, key).setOrigin(0.5);
        art.setScale((cardW - 24) / art.width);
        card.root.add(art);
        card.art = art;
      }
      card.root.add(this.text(0, cardH / 2 - 34, id.toUpperCase(), 24).setOrigin(0.5));
      this.stagger(card, i);
    });
  }

  private buildChars(): void {
    const cpu = isCpu(this.state);
    this.layer.add(this.text(VIEW_WIDTH / 2, 70, "SELECT YOUR FIGHTER", 36, CSS.orange));
    this.layer.add(
      this.text(
        VIEW_WIDTH / 2, 660,
        this.state.touch
          ? "TAP a fighter · TAP again to lock in"
          : cpu ? "P1 A/D move · ENTER or F lock · ESC back" : "P1 A/D + F   |   P2 ← → + ,   |   ESC back",
        18, CSS.dim,
      ),
    );
    // Card size comes from the Phaser-free module so a test exercises the SAME arithmetic the scene
    // draws with. At the shipped three cards this is 300x420, identical to the constants it replaces.
    const cardW = characterCardWidth(this.roster.length);
    const cardH = Math.round(cardW * 1.4);
    const gap = 60;
    const total = this.roster.length * cardW + (this.roster.length - 1) * gap;
    this.roster.forEach((id, i) => {
      const x = (VIEW_WIDTH - total) / 2 + i * (cardW + gap) + cardW / 2;
      const card = this.makeCard(x, 350, cardW, cardH);
      const key = `portrait-${id}`;
      if (this.textures.exists(key)) {
        const art = this.add.image(0, -22, key).setOrigin(0.5);
        art.setScale((cardW - 20) / art.width);
        card.root.add(art);
        card.art = art;
      }
      card.root.add(this.text(0, cardH / 2 - 30, id.toUpperCase(), 26).setOrigin(0.5));
      this.stagger(card, i);
    });
  }

  private makeCard(x: number, y: number, w: number, h: number): Card {
    const index = this.cards.length;
    const root = this.add.container(x, y).setDepth(10);
    const bg = this.add.rectangle(0, 0, w, h, DUSK_VIOLET, 0.85).setOrigin(0.5);
    // The whole card is the tap target on touch — a phone player has no keys to move a cursor with.
    // The rect is a CHILD of the container; Phaser resolves its hit area through the parent transform.
    if (this.state.touch) bg.setInteractive({ useHandCursor: true }).on("pointerup", () => this.tapCard(index));
    const frame = this.add.graphics();
    root.add([bg, frame]);
    this.layer.add(root);
    const card: Card = { root, frame, w, h };
    this.cards.push(card);
    return card;
  }

  private stagger(card: Card, i: number): void {
    card.root.setAlpha(0).setY(card.root.y + 14);
    const settle = (): void => { card.root.setAlpha(1); };
    this.tweens.add({
      targets: card.root,
      alpha: 1,
      y: card.root.y - 14,
      duration: 160,
      delay: i * STAGGER_MS,
      ease: "Cubic.easeOut",
      // A card that fades IN from 0 is one interrupted tween away from being invisible forever.
      // Whatever ends this tween — completion or a stop — the card ends up visible.
      onComplete: settle,
      onStop: settle,
    });
  }

  /** Repaint selection frames + scales. Colour is never the only signal: P1 draws a SOLID frame and
   *  a P1 tag, P2 a DASHED frame and a P2 tag — the same vocabulary render/boxes.ts uses. */
  private paint(): void {
    const s = this.state;
    for (const t of this.tags) t.destroy();
    this.tags = [];
    this.cards.forEach((card, i) => {
      card.frame.clear();
      const selected = s.step === "chars" ? -1 : s.step === "stage" ? s.stageIndex : s.modeIndex;
      const owners: Player[] = s.step === "chars"
        ? ([0, 1] as Player[]).filter((p) => s.cursors[p] === i && (p === 0 || !isCpu(s) || s.locked[1]))
        : [];
      const active = s.step === "chars" ? owners.length > 0 : selected === i;

      if (s.step === "chars") {
        owners.forEach((p, k) => {
          const inset = k * 8;
          this.frameRect(card, p === 0 ? P1_BLUE : P2_RED, p === 1, inset, s.locked[p]);
        });
      } else if (active) {
        this.frameRect(card, DUSK_ORANGE, false, 0, false);
      } else {
        this.frameRect(card, DUSK_ROSE, false, 0, false, 0.85);
      }

      // Repaints happen per keypress: replace this card's own scale tween, nothing else's.
      card.scaleTween?.stop();
      card.scaleTween = this.tweens.add({
        targets: card.root,
        scale: active ? 1.04 : 1,
        duration: MOVE_MS,
        ease: "Cubic.easeOut",
      });
    });

    if (this.state.step === "chars") this.paintTags();
  }

  private frameRect(card: Card, color: number, dashed: boolean, inset: number, locked: boolean, alpha = 1): void {
    const g = card.frame;
    const x = -card.w / 2 + inset;
    const y = -card.h / 2 + inset;
    const w = card.w - inset * 2;
    const h = card.h - inset * 2;
    g.lineStyle(locked ? 6 : 4, color, alpha);
    if (!dashed) {
      g.strokeRect(x, y, w, h);
      return;
    }
    const DASH = 14;
    const edge = (x1: number, y1: number, x2: number, y2: number): void => {
      const len = Math.hypot(x2 - x1, y2 - y1);
      const ux = (x2 - x1) / len;
      const uy = (y2 - y1) / len;
      for (let d = 0; d < len; d += DASH * 2) {
        const e = Math.min(d + DASH, len);
        g.lineBetween(x1 + ux * d, y1 + uy * d, x1 + ux * e, y1 + uy * e);
      }
    };
    edge(x, y, x + w, y);
    edge(x + w, y, x + w, y + h);
    edge(x + w, y + h, x, y + h);
    edge(x, y + h, x, y);
  }

  /** P1/P2 (or CPU) tags above the card each player holds, plus a LOCKED stamp. */
  private paintTags(): void {
    const s = this.state;
    for (const p of [0, 1] as Player[]) {
      if (p === 1 && isCpu(s) && !s.locked[1]) continue;
      const card = this.cards[s.cursors[p]];
      if (!card) continue;
      const label = p === 0 ? "P1" : isCpu(s) ? "CPU" : "P2";
      const tag = this.text(card.root.x, card.root.y - card.h / 2 - 26, s.locked[p] ? `${label} LOCKED` : label, 22, p === 0 ? "#66ccff" : "#ff8866");
      this.layer.add(tag);
      this.tags.push(tag);
    }
  }

  /**
   * Lock-in pop: a scale yoyo plus a white FILL tint. In Phaser 4 setTintFill() is a deprecated
   * no-op and a white MULTIPLY tint is invisible, so the mode has to be switched explicitly and
   * switched back — the same fix FighterSprite.flashBlock() carries.
   *
   * The CONTINUATION hangs off the scene Clock, not the tween's onComplete. Phaser 4's TweenManager
   * takes its delta from `Date.now()` (TweenManager.getDelta), so a tween is wall-clock driven: it
   * does not advance under a pumped game.step, which would make the whole select screen untestable,
   * and a killed or interrupted tween would strand the flow with both players locked and no match.
   * Time.Clock is delta-driven, so it advances with the game step. The tween stays decoration.
   */
  private flash(cardIndex: number, done: () => void): void {
    const card = this.cards[cardIndex];
    const restore = (): void => {
      card?.art?.clearTint();
      card?.art?.setTintMode(Phaser.TintModes.MULTIPLY);
    };
    if (card) {
      card.art?.setTint(0xffffff).setTintMode(Phaser.TintModes.FILL);
      this.tweens.add({ targets: card.root, scale: 1.12, duration: FLASH_MS, yoyo: true, ease: "Sine.easeInOut" });
    }
    this.time.delayedCall(FLASH_MS * 2, () => {
      restore();
      done();
    });
  }

  private teardown(): void {
    this.tweens.killTweensOf(this.cards.map((c) => c.root));
    this.cards = [];
    this.tags = [];
    this.input.keyboard?.removeAllListeners();
    // Drop the DEV hook with the scene: a window global still answering `state()` after the flow has
    // shut down reads as "the menu is still up" to anything inspecting it.
    if (import.meta.env.DEV) delete (window as unknown as { __flow?: unknown }).__flow;
  }
}
