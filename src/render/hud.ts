import * as Phaser from "phaser";
import { World } from "../sim/world";
import { VIEW_WIDTH } from "../sim/constants";
import { hudEntrance } from "./hud-entrance";
import { meterView, type MeterView } from "./meter-view";

/** Phase 07's UI atlas. Loaded by BootScene; every frame below is validated before anything is drawn. */
const ATLAS = "hud-atlas";
const BAR_PLATE = "health-bar";
const BAR_SLOT = "health-bar-slot";
const PORTRAIT_PLATE = "portrait-base";
const PORTRAIT_SLOT = "portrait-slot";

/** The only authored numbers. Everything else — bar width and HEIGHT, where the fill goes, where the
 *  face goes — is measured off the atlas frames, because the art decides those and the art has
 *  already shipped (`health-bar` came out 460x144, not the 8:1 the prompt asked for).
 *  ponytail: two scales + three offsets is the whole layout language; if the HUD ever needs a third
 *  arrangement, that's the moment for a layout table, not now. */
/** The bar plate is drawn NON-uniformly: wider than it is tall, on request. The art is a fixed
 *  3.19:1 (460x144) with 40 px of solid bezel above and below the slot — that bezel is frame, not
 *  padding, so it cannot be cropped away, and a uniform scale that makes the bar thin also makes it
 *  short. Anisotropy is the only lever. Keep the ratio under ~2:1 or the rivets read as ovals. */
const BAR_SCALE_X = 0.86;
const BAR_SCALE_Y = 0.5;
/** Bigger than the bar's scale on purpose, and not only for composition: the portrait is a 448x600
 *  texture and Phaser only builds mipmaps for power-of-two textures, so a heavy downscale is a raw
 *  bilinear squeeze and reads as soft/low-res. At 0.32 the face draws at ~110x147 from 448x600 —
 *  a 4.1x reduction instead of 6.5x. If it still reads soft, the fix is to bake a HUD-sized portrait
 *  (LANCZOS, cover-cropped to the arch's aspect) via the `--hud` flag `copy-portraits.py` already
 *  anticipates, rather than to keep enlarging this. */
const PORTRAIT_SCALE = 0.32;
const MARGIN = 24; // screen edge -> portrait plate
const GAP = 10; // portrait plate -> bar plate
const TOP = 20;
const PIP_GAP = 6; // bar bottom -> pips

/** Health colour tiers + the low-health blink, carried over from the vector HUD unchanged. */
const HEALTH_HIGH = 0x44dd44;
const HEALTH_MID = 0xdddd33;
const HEALTH_LOW = 0xdd3333;
/** Each tier drawn as a vertical gradient rather than one flat colour. At 24 px tall the flat fill
 *  was fine; at the art's 62 px slot it read as a plastic slab pasted over a painted bevel. Each
 *  pair brackets its tier colour (lighter top, darker bottom) — it is not an exact arithmetic
 *  midpoint, it is eyeballed against the plate's own bevel. The tier a player READS is decided by
 *  the flat colour above, which is also what the Canvas fallback and the DEV snapshot use. */
const HEALTH_GRADIENT: Record<number, [number, number]> = {
  [HEALTH_HIGH]: [0x86f086, 0x2a9c2a],
  [HEALTH_MID]: [0xf2f27d, 0xa5a516],
  [HEALTH_LOW]: [0xf07d7d, 0x9c1f1f],
};
const LOW_HEALTH = 0.25;
const MID_HEALTH = 0.5;

/** Super meter (Phase 15). Its own Phase 07 atlas plate, packed to the same 460 px width as the
 *  health bar so the two bevels line up, and drawn with the SAME anisotropic scales — the meter's
 *  frame art has bezel above and below its channel exactly like the bar's, so a uniform scale cannot
 *  make it "thinner and wider" either. Geometry comes off the frame (`slotIn`), never authored here:
 *  a re-cut plate moves the fill with it. The fill is drawn into `fillG` at depth 100, BEHIND the
 *  plate at 101, so it shows through the transparent `meter-bar-slot`. */
const METER_PLATE = "meter-bar";
const METER_SLOT = "meter-bar-slot";
const METER_GAP = 6; // bar plate bottom -> meter plate top
const METER_EMPTY = 0x241a30;
const METER_FILL: [number, number] = [0x6fd8ff, 0x2a6ea8];
/** Full bar: a hotter colour AND a pulse, because "you have a super" has to be readable at a glance
 *  mid-fight. Same mechanism as the low-health blink, deliberately gentler — this is good news. */
const METER_FULL: [number, number] = [0xffe27a, 0xf07830];
const METER_PULSE_MS = 380;
const METER_PULSE_DIM = 0.6;
/** Shown only while the sim would actually let the super out — see meter-view.ts. */
const READY_LABEL = "MAX";
/** The low-health blink was `BLINK_MS = 120` and a full on/off cut, carried over from the vector HUD.
 *  On a 24 px rectangle that was a subtle blink; on the art's 62 px painted slot the QA pass measured
 *  it at ~4.3 Hz of full-bar disappearance and called it a strobe, which is both unpleasant and past
 *  the usual 3 Hz comfort guidance for large flashing content. Same mechanism, retuned for the size
 *  of the thing that is now flashing: slower, and a dim pulse rather than a vanish — the bar stays
 *  readable while still shouting. */
const BLINK_MS = 250;
const BLINK_DIM = 0.28;

interface Slot {
  dx: number;
  dy: number;
  w: number;
  h: number;
}

/** A frame's rect inside its plate, scaled. Slot frames are packed in ATLAS space, so the plate's own
 *  origin has to come off first (`sprite-schema.md`). Takes x and y scales separately because the bar
 *  plate is drawn anisotropically; pass the same number twice for a uniform one. */
function slotIn(plate: Phaser.Textures.Frame, slot: Phaser.Textures.Frame, sx: number, sy: number): Slot {
  return {
    dx: (slot.cutX - plate.cutX) * sx,
    dy: (slot.cutY - plate.cutY) * sy,
    w: slot.width * sx,
    h: slot.height * sy,
  };
}

export class Hud {
  private fillG: Phaser.GameObjects.Graphics;
  private faces: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private facePlates: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private barPlates: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private timerText: Phaser.GameObjects.Text;
  private centerText: Phaser.GameObjects.Text;
  private p1Pips: Phaser.GameObjects.Text;
  private p2Pips: Phaser.GameObjects.Text;
  /** Everything the HUD owns, for a caller that has to assign objects to a camera. Kept as one list
   *  so adding an element here can't silently leave it rendering on the world camera too. */
  readonly objects: Phaser.GameObjects.GameObject[];

  /** Parked y of everything the entrance slides, captured at build time. The slide is applied as an
   *  offset from these, so it can never accumulate. */
  private slides: { obj: Phaser.GameObjects.Components.Transform; baseY: number }[] = [];

  private scene: Phaser.Scene;
  private barW: number;
  private barH: number;
  private barTop: number;
  private barX: [number, number];
  private slot: Slot;
  private meterW = 0;
  private meterH = 0;
  private meterSlot!: Slot;
  private meterPlates!: [Phaser.GameObjects.Image, Phaser.GameObjects.Image];
  private readyText!: [Phaser.GameObjects.Text, Phaser.GameObjects.Text];
  private window: Slot;
  private shownIds: [string, string] = ["", ""];
  private lastFill: [number, number] = [0, 0];
  private lastMeter: [number, number] = [0, 0];
  private meterY = 0;
  private lastColor: [number, number] = [HEALTH_HIGH, HEALTH_HIGH];
  private lastAlpha: [number, number] = [1, 1];
  private lastBlinkOff = false;
  private lastFillFrac = 1;

  /** `ids` rather than a `World`: PlaygroundScene builds its world AFTER the HUD, and both scenes
   *  know their two fighter ids before either exists. The textures are re-applied lazily in update()
   *  anyway, since Playground rebuilds its world on every stat edit. */
  constructor(scene: Phaser.Scene, ids: [string, string]) {
    // Validate the whole atlas up front and throw naming the frame, the way stage.ts does for props.
    // A HUD with a hole in it is worse than a scene that refuses to start.
    const tex = scene.textures.get(ATLAS);
    for (const frame of [BAR_PLATE, BAR_SLOT, METER_PLATE, METER_SLOT, PORTRAIT_PLATE, PORTRAIT_SLOT]) {
      if (!tex || !tex.has(frame)) throw new Error(`hud: missing frame "${frame}" in atlas "${ATLAS}"`);
    }
    const barFrame = tex.get(BAR_PLATE);
    const meterFrame = tex.get(METER_PLATE);
    const faceFrame = tex.get(PORTRAIT_PLATE);
    this.barW = barFrame.width * BAR_SCALE_X;
    this.barH = barFrame.height * BAR_SCALE_Y;
    this.slot = slotIn(barFrame, tex.get(BAR_SLOT), BAR_SCALE_X, BAR_SCALE_Y);
    this.meterW = meterFrame.width * BAR_SCALE_X;
    this.meterH = meterFrame.height * BAR_SCALE_Y;
    this.meterSlot = slotIn(meterFrame, tex.get(METER_SLOT), BAR_SCALE_X, BAR_SCALE_Y);
    const plateW = faceFrame.width * PORTRAIT_SCALE;
    const win = slotIn(faceFrame, tex.get(PORTRAIT_SLOT), PORTRAIT_SCALE, PORTRAIT_SCALE);
    this.scene = scene;
    this.window = win;

    // Portrait outboard at the screen edge, bar inboard running toward centre; P2 mirrors.
    const faceX: [number, number] = [MARGIN, VIEW_WIDTH - MARGIN - plateW];
    this.barX = [MARGIN + plateW + GAP, VIEW_WIDTH - MARGIN - plateW - GAP - this.barW];
    // The portrait plate is much taller than the bar (it is a 0.74:1 bust, the bar is 3.19:1), so the
    // bar is centred against it rather than top-aligned — top-aligned left the bar floating at the
    // ceiling with a tall frame hanging beside it.
    const plateH = faceFrame.height * PORTRAIT_SCALE;
    this.barTop = TOP + (plateH - this.barH) / 2;
    // The meter sits BELOW the whole bar plate, not below the plate's fill slot. Measuring from the
    // slot put it at barTop+57 against a 72px plate — still inside the art, and the plate is opaque
    // everywhere except the slot itself, so the meter drew every frame and was completely invisible.
    // Every test still passed: the width it reported was real, it was just underneath the bezel. Only
    // looking at the screen caught it.
    this.meterY = this.barTop + this.barH + METER_GAP;
    const pipY = this.meterY + this.meterH + PIP_GAP;

    // Depth 100/101 with creation order deciding within a band (Phaser sorts stably by depth). The
    // faces must NOT drop to 99: the match-end scrim is depth 99 and is created later, so it would
    // dim the face while the depth-101 plate above it stayed bright.
    // Built hidden on a placeholder frame: an Image needs SOME texture at construction, and showing
    // the plate art twice is worse than showing nothing. applyPortraits() reveals it once a real
    // portrait is in place.
    const face = (i: 0 | 1): Phaser.GameObjects.Image =>
      scene.add.image(faceX[i] + win.dx + win.w / 2, TOP + win.dy + win.h / 2, ATLAS, PORTRAIT_PLATE)
        .setOrigin(0.5)
        .setDepth(100)
        .setVisible(false)
        .setScrollFactor(0);
    this.faces = [face(0), face(1)];

    // One Graphics for both bars' backdrop + coloured fill, drawn BEHIND the plates so it shows
    // through the transparent `health-bar-slot` while the bevel stays on top.
    this.fillG = scene.add.graphics().setDepth(100).setScrollFactor(0);

    const plate = (x: number, y: number, frame: string, flip: boolean): Phaser.GameObjects.Image =>
      scene.add.image(x, y, ATLAS, frame)
        .setOrigin(0, 0) // the slot arithmetic is top-left based; an Image defaults to centred
        .setScale(...(frame === PORTRAIT_PLATE ? [PORTRAIT_SCALE, PORTRAIT_SCALE] : [BAR_SCALE_X, BAR_SCALE_Y]) as [number, number])
        .setFlipX(flip)
        .setDepth(101)
        .setScrollFactor(0);
    this.facePlates = [plate(faceX[0], TOP, PORTRAIT_PLATE, false), plate(faceX[1], TOP, PORTRAIT_PLATE, false)];
    this.barPlates = [plate(this.barX[0], this.barTop, BAR_PLATE, false), plate(this.barX[1], this.barTop, BAR_PLATE, true)];
    // P2's meter is flipped for the same reason its bar is: the plate art is lit from the top-left,
    // so an unmirrored copy on the right reads as a different piece of furniture.
    this.meterPlates = [plate(this.barX[0], this.meterY, METER_PLATE, false), plate(this.barX[1], this.meterY, METER_PLATE, true)];

    const font = { fontFamily: "monospace", color: "#ffffff" };
    // Timer under the bars, not above them: the plates now run nearly to the centre, and a number
    // sitting in the gap between them read as a third HUD element rather than the round clock.
    this.timerText = scene.add.text(VIEW_WIDTH / 2, this.barTop + this.barH + 6, "", { ...font, fontSize: "44px" }).setOrigin(0.5, 0).setDepth(101).setScrollFactor(0);
    this.centerText = scene.add.text(VIEW_WIDTH / 2, 300, "", { ...font, fontSize: "60px", color: "#ffdd44" }).setOrigin(0.5).setDepth(101).setScrollFactor(0);
    // Sits ON the meter plate, centred, and is created AFTER the plates so the stable depth sort in
    // band 101 puts it above them. Dark on the gold READY fill; it is only ever visible over that.
    const ready = (i: 0 | 1): Phaser.GameObjects.Text =>
      scene.add.text(this.barX[i] + this.meterW / 2, this.meterY + this.meterH / 2, READY_LABEL, {
        ...font, fontSize: "20px", color: "#3a1e00", fontStyle: "bold",
      }).setOrigin(0.5).setDepth(101).setScrollFactor(0).setVisible(false);
    this.readyText = [ready(0), ready(1)];

    this.p1Pips = scene.add.text(this.barX[0], pipY, "", { ...font, fontSize: "18px", color: "#66ccff" }).setDepth(101).setScrollFactor(0);
    this.p2Pips = scene.add.text(this.barX[1] + this.barW, pipY, "", { ...font, fontSize: "18px", color: "#ff8866" }).setOrigin(1, 0).setDepth(101).setScrollFactor(0);

    this.objects = [
      ...this.faces,
      this.fillG,
      ...this.facePlates,
      ...this.barPlates,
      ...this.meterPlates,
      ...this.readyText,
      this.timerText,
      this.centerText,
      this.p1Pips,
      this.p2Pips,
    ];
    // The announce text is centre-screen and belongs to the round, not to the band — it stays put.
    for (const o of [...this.faces, ...this.facePlates, ...this.barPlates, ...this.meterPlates, ...this.readyText, this.timerText, this.p1Pips, this.p2Pips]) {
      this.slides.push({ obj: o, baseY: o.y });
    }

    this.applyPortraits(ids);
  }

  /** Cover-crop each portrait into its plate's window: scale to the LARGER ratio so the window is
   *  fully covered, never letterboxed (an aspect-fit is what left Phase 11's cards with a black
   *  band). The ~22 px of horizontal overflow per side lands under the plate's 81 px frame, so no
   *  crop and no mask is needed; at the arch's antialiased edge the face blends through, which is
   *  exactly what the arch is for. */
  private applyPortraits(ids: [string, string]): void {
    for (const i of [0, 1] as const) {
      if (ids[i] === this.shownIds[i]) continue;
      // Prefer the HUD bake (`npm run copy:portraits`): it is the same bust already cover-cropped to
      // this arch and LANCZOS-resampled to HUD size, so the GPU is not squeezing a 448x600 card into
      // ~96x147 with no mipmaps. Fall back to the select card if it has not been baked.
      const key = [`hud-portrait-${ids[i]}`, `portrait-${ids[i]}`].find((k) => this.scene.textures.exists(k));
      if (!key) continue; // a dev scene with an unbaked portrait still runs
      const img = this.faces[i];
      img.setTexture(key);
      img.setScale(Math.max(this.window.w / img.width, this.window.h / img.height));
      img.setVisible(true);
      this.shownIds[i] = ids[i];
    }
  }

  /** `health` is what the fighter actually has; `draw` is what to render, which the entrance scales
   *  down while the bar charges. They must stay separate: keying the colour off the animated value
   *  made a full-health fighter open the round RED and blink through yellow into green. */
  private bar(i: 0 | 1, health: number, draw: number, blink: boolean, dy: number): void {
    const x = this.barX[i];
    // Mirrored plate => mirrored slot. With the shipped art's symmetric 40/40 margins this is the
    // same number, but deriving it means a re-cut bar can't silently misplace the fill.
    const dx = i === 0 ? this.slot.dx : this.barW - this.slot.dx - this.slot.w;
    const y = this.barTop + this.slot.dy + dy;
    this.fillG.fillStyle(0x000000, 0.55);
    this.fillG.fillRect(x + dx, y, this.slot.w, this.slot.h);

    let color = HEALTH_HIGH;
    if (health < MID_HEALTH) color = HEALTH_MID;
    if (health < LOW_HEALTH) color = HEALTH_LOW;
    this.lastColor[i] = color;
    const alpha = blink && health < LOW_HEALTH ? BLINK_DIM : 1;
    this.lastAlpha[i] = alpha;

    const w = this.slot.w * Phaser.Math.Clamp(draw, 0, 1);
    this.lastFill[i] = w;
    if (w <= 0) return; // nothing to draw: a dead fighter, or the first ticks of the entrance
    // Solid FIRST, gradient second. `fillGradientStyle` is WebGL-only and the Canvas renderer skips
    // the command outright — without this the bar would inherit the black backdrop style above and
    // draw a black fill on a Canvas fallback (the game boots Phaser.AUTO).
    const [top, bottom] = HEALTH_GRADIENT[color];
    this.fillG.fillStyle(color, alpha);
    this.fillG.fillGradientStyle(top, top, bottom, bottom, alpha);
    // P1 drains toward the centre, P2 toward its own edge — the fill is anchored on the outboard end.
    this.fillG.fillRect(i === 0 ? x + dx : x + dx + this.slot.w - w, y, w, this.slot.h);
  }

  /** The super meter strip, drawn into its own plate's channel. Slot frames are packed in ATLAS
   *  space, so a flipped (P2) plate needs the mirrored slot `meterW - dx - w` — the same arithmetic
   *  `bar()` does, off the meter's own frame rather than the health bar's. */
  private meter(i: 0 | 1, view: MeterView, pulse: boolean, dy: number): void {
    const x = this.barX[i];
    const s = this.meterSlot;
    const dx = i === 0 ? s.dx : this.meterW - s.dx - s.w;
    const y = this.meterY + s.dy + dy;
    const w = s.w;

    this.fillG.fillStyle(METER_EMPTY, 0.85);
    this.fillG.fillRect(x + dx, y, w, s.h);

    // `showMax`, not `ready`: the cue must agree with the BAR, and during the round entrance a
    // carried-over full meter is ready while the drawn fill is still zero (see meter-view.ts). The
    // label says it in words, because a gold fill on its own never told the player anything.
    const full = view.showMax;
    this.readyText[i].setVisible(full).setAlpha(full && pulse ? METER_PULSE_DIM : 1);
    const fw = w * Phaser.Math.Clamp(view.fillFrac, 0, 1);
    // Recorded AFTER the fill is actually drawn (below), never here: assigning it up front makes the
    // e2e's width assertions survive the `fillRect` being deleted, which is a snapshot that reports
    // bookkeeping rather than rendering — the exact thing `snapshot()` exists to avoid.
    this.lastMeter[i] = 0;
    if (fw <= 0) return;
    const alpha = full && pulse ? METER_PULSE_DIM : 1;
    const [top, bottom] = full ? METER_FULL : METER_FILL;
    // Solid before gradient — `fillGradientStyle` is WebGL-only and Canvas skips it, which would
    // otherwise leave this drawing in the dark backdrop colour set just above. Same trap as bar().
    this.fillG.fillStyle(top, alpha);
    this.fillG.fillGradientStyle(top, top, bottom, bottom, alpha);
    // Both meters fill from the OUTBOARD edge, matching their health bar above.
    this.fillG.fillRect(i === 0 ? x + dx : x + dx + w - fw, y, fw, s.h);
    this.lastMeter[i] = fw;
  }

  update(world: World, timeMs: number): void {
    const m = world.match;
    // The entrance rides the sim's intro countdown, not a tween or a wall clock — see hud-entrance.ts.
    // PlaygroundScene zeroes introTicks before it advances, so it always renders the settled state;
    // that's intended (the entrance is a match-start flourish, not something a tuning scene needs).
    const entrance = hudEntrance(m.phase, m.introTicks);
    for (const s of this.slides) s.obj.y = s.baseY + entrance.slideY;
    this.lastFillFrac = entrance.fillFrac;

    this.applyPortraits([world.fighters[0].cfg.id, world.fighters[1].cfg.id]);

    this.fillG.clear();
    const [a, b] = world.fighters;
    const blink = Math.floor(timeMs / BLINK_MS) % 2 === 0;
    this.lastBlinkOff = blink;
    const aFrac = a.health / a.cfg.stats.maxHealth;
    const bFrac = b.health / b.cfg.stats.maxHealth;
    this.bar(0, aFrac, aFrac * entrance.fillFrac, blink, entrance.slideY);
    this.bar(1, bFrac, bFrac * entrance.fillFrac, blink, entrance.slideY);
    // The meter rides the entrance's fill fraction too, so the whole band charges as one.
    const pulse = Math.floor(timeMs / METER_PULSE_MS) % 2 === 0;
    this.meter(0, meterView(a.meter, entrance.fillFrac), pulse, entrance.slideY);
    this.meter(1, meterView(b.meter, entrance.fillFrac), pulse, entrance.slideY);

    this.timerText.setText(String(m.secondsLeft));
    this.p1Pips.setText("P1 " + "●".repeat(m.wins[0]));
    this.p2Pips.setText("●".repeat(m.wins[1]) + " P2");

    let center = "";
    if (m.phase === "intro") center = m.introTicks > 30 ? `ROUND ${m.round}` : "FIGHT!";
    else if (m.phase === "roundEnd") center = m.lastRoundWinner === null ? "DRAW" : `P${m.lastRoundWinner + 1} WINS`;
    else if (m.phase === "matchEnd") center = m.matchWinner === null ? "DRAW" : `P${m.matchWinner + 1} WINS THE MATCH!`;
    this.centerText.setText(center);
  }

  /** Read-only snapshot for the DEV `__hud()` seam. Plain data, like `__endMenu()` — a spec must not
   *  hold a reference into a scene that may be shut down under it.
   *
   *  Everything here that CAN be read back off a real object is: `slideY` is measured from the bar
   *  plate's actual y against its parked y, and `drawCommands` is the length of the Graphics command
   *  buffer, so a spec fails if the objects stop moving or the fill stops being drawn. A snapshot
   *  built purely from bookkeeping fields would stay green with the rendering deleted. */
  snapshot(): {
    slideY: number;
    fillFrac: number;
    barY: number;
    slotW: number;
    faceY: number[];
    bandBottom: number;
    drawCommands: number;
    fill: { w: number; color: number; alpha: number }[];
    meter: { w: number; max: number }[];
    meterReady: boolean[];
    meterLabel: string[];
    blinkOff: boolean;
    portraitKeys: string[];
  } {
    const parked = this.slides.find((s) => s.obj === this.barPlates[0]);
    return {
      slideY: this.barPlates[0].y - (parked?.baseY ?? 0),
      fillFrac: this.lastFillFrac,
      barY: this.barPlates[0].y,
      slotW: this.slot.w,
      faceY: this.faces.map((f) => f.y),
      // Lowest edge of anything the entrance slides — the portrait plate is the tallest piece.
      bandBottom: this.facePlates[0].y + this.facePlates[0].displayHeight,
      // Phaser stores each fill style / rect as a run of numbers in this buffer, cleared every frame.
      drawCommands: (this.fillG as unknown as { commandBuffer: number[] }).commandBuffer.length,
      fill: [
        { w: this.lastFill[0], color: this.lastColor[0], alpha: this.lastAlpha[0] },
        { w: this.lastFill[1], color: this.lastColor[1], alpha: this.lastAlpha[1] },
      ],
      // Drawn width and the width a FULL bar would be, so a spec can assert a fraction without
      // re-deriving the meter's geometry from the atlas.
      meter: [
        { w: this.lastMeter[0], max: this.meterSlot.w },
        { w: this.lastMeter[1], max: this.meterSlot.w },
      ],
      // Read off the real Text objects, not a cached flag: the point of the label is that it is ON
      // SCREEN when the super will come out, so a snapshot of bookkeeping would report a cue that had
      // been deleted from the display list. The STRING comes too — visibility alone is satisfied by an
      // invisible empty label, which is a cue the player cannot read.
      meterReady: this.readyText.map((t) => t.visible),
      meterLabel: this.readyText.map((t) => (t.visible ? t.text : "")),
      blinkOff: this.lastBlinkOff,
      portraitKeys: this.faces.map((f) => f.texture.key),
    };
  }
}
