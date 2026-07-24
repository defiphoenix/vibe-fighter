import * as Phaser from "phaser";
import { Fighter } from "../sim/fighter";
import { toWorld } from "../sim/geometry";
import { GROUND_Y, VIEW_WIDTH } from "../sim/constants";
import { loadRegistry, buildConfig, type CharacterRegistry } from "../render/characters";
import { FighterSprite } from "../render/fighter-sprite";
import { installFocusGuard, num, numRow, row, saveRegistry, select } from "../render/dev-panel";
import { guardView, mergeFrameOverride, persistGuard, toAuthored, type GuardKind } from "../render/gym-persist";
import { STATE_NAMES } from "../sim/validate-character";
import { isGuardableState } from "../sim/types";
import type { Box, CharacterData, FrameOverride, StateName } from "../sim/types";

const FX = VIEW_WIDTH / 2; // fighter feet-center x (camera unscrolled → world == screen)
const FY = GROUND_Y;
const COL = { hurt: 0x33dd55, hit: 0xff3355, push: 0xffffff, guardStand: 0x33bbff, guardCrouch: 0x33bbff, sel: 0xffe000 };

type EditKind = "hurt" | "push" | "hit" | GuardKind;
interface Editable { box: Box; kind: EditKind; idx: number }

const isGuardKind = (k: EditKind): k is GuardKind => k === "guardStand" || k === "guardCrouch";

/** Dev-only Character Gym (?scene=gym). Displays one fighter's authored boxes on the exact combat
 *  path (a real Fighter → activeBoxes), edits them with Q (translate) / W (scale) gizmos, and saves
 *  to public/configs/character-gym.json via the dev Vite middleware. No sparring: combat "flows"
 *  because the Match scene reloads the saved JSON.
 *  Guard boxes are editable on any state that can carry one, but they edit the STANCE TEMPLATE (all
 *  frames) rather than a single frame — see render/gym-persist.ts. Per-frame guard variation is a
 *  hand-authored JSON override; the sim honours it, the Gym just doesn't author it.
 *  ponytail: no live sparring preview here. */
export class GymScene extends Phaser.Scene {
  private reg!: CharacterRegistry;
  private rawFile!: Record<string, { render: unknown; data: CharacterData }>;
  private id!: string;
  private working!: CharacterData; // mutable working copy of the current fighter
  private fighter!: Fighter;
  private sprite!: FighterSprite;
  private overlay!: Phaser.GameObjects.Graphics;
  private state: StateName = "idle";
  private frame = 0;
  private mode: "translate" | "scale" = "translate";
  private sel = 0;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };
  private panel!: HTMLDivElement;
  private inputs!: Record<"x" | "y" | "w" | "h", HTMLInputElement>;
  private status!: HTMLSpanElement;

  constructor() {
    super("Gym");
  }

  create(): void {
    this.reg = loadRegistry(this.cache.json);
    this.rawFile = this.cache.json.get("characters");
    this.id = Object.keys(this.reg)[0];
    this.overlay = this.add.graphics().setDepth(50);
    this.add.text(12, 12, "Character Gym — Q translate · W scale · Tab box · [ ] frame · arrows nudge", {
      fontFamily: "monospace", fontSize: "16px", color: "#cfe",
    }).setDepth(200).setScrollFactor(0);

    this.buildPanel();
    this.loadFighter(this.id);
    this.bindKeys();
    this.bindPointer();

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.teardown());
    if (import.meta.env.DEV) {
      (window as unknown as { __gym: unknown }).__gym = {
        setState: (s: StateName) => this.setState(s),
        edit: (dx: number, dy: number) => this.nudge(dx, dy),
        save: () => this.save(),
        // Selecting by KIND, not by simulating Tab presses: trusted keyboard events don't reach
        // Phaser headless, so an e2e has no other way to land on a specific box.
        selectKind: (kind: EditKind): boolean => {
          const i = this.editable().findIndex((e) => e.kind === kind);
          if (i < 0) return false;
          this.sel = i;
          this.redraw();
          return true;
        },
        current: () => {
          const e = this.editable()[this.sel];
          return { id: this.id, state: this.state, frame: this.frame, sel: this.sel, kind: e?.kind, box: e?.box };
        },
        // What WOULD be saved. Lets a spec check that a guard edit landed on the stance template and
        // wrote no per-frame override, without having to save and re-read the real registry file.
        data: () => JSON.parse(JSON.stringify(this.working)) as CharacterData,
        /** The assembled frame the sim would actually use — the claim the template edit is making. */
        frameGuard: (state: StateName, frame: number) => {
          const spec = this.fighter.cfg.states[state];
          const f = spec.frames[Math.min(frame, spec.frames.length - 1)];
          return { guardStand: f.guardStand, guardCrouch: f.guardCrouch };
        },
      };
    }
  }

  private loadFighter(id: string): void {
    this.id = id;
    this.working = JSON.parse(JSON.stringify(this.reg[id].data)) as CharacterData;
    this.sprite?.destroy();
    this.sprite = new FighterSprite(this, id, this.reg[id].render, this.working.stats.scale, this.working);
    this.state = "idle";
    this.frame = 0;
    this.sel = 0;
    this.rebuild();
  }

  /** Re-assemble the working data into a fresh Fighter (Codex: rebuild, don't just re-assemble) and
   *  re-pose the sprite, then redraw. */
  private rebuild(): void {
    this.fighter = new Fighter(buildConfig(this.id, { render: this.reg[this.id].render, data: this.working }), 0);
    this.fighter.reset(FX, 1);
    (this.fighter as unknown as { state: StateName }).state = this.state;
    this.fighter.stateFrame = this.frame;
    this.redraw();
  }

  /** hurt/push/hit come off the assembled frame (they ARE per-frame). Guard comes off a scaled view
   *  of the stance template instead — see gym-persist.guardView for why the frame's own guard box is
   *  the wrong thing to hand the user. Guard entries only appear on states that can carry one. */
  private editable(): Editable[] {
    const spec = this.fighter.cfg.states[this.state];
    const f = spec.frames[Math.min(this.frame, spec.frames.length - 1)];
    const list: Editable[] = [];
    f.hurt.forEach((box, idx) => list.push({ box, kind: "hurt", idx }));
    list.push({ box: f.push, kind: "push", idx: 0 });
    f.hit.forEach((box, idx) => list.push({ box, kind: "hit", idx }));
    if (isGuardableState(this.state)) {
      for (const kind of ["guardStand", "guardCrouch"] as const) {
        guardView(this.working, kind).forEach((box, idx) => list.push({ box, kind, idx }));
      }
    }
    return list;
  }

  private redraw(): void {
    const simFrames = this.fighter.cfg.states[this.state].frames.length;
    this.frame = Phaser.Math.Clamp(this.frame, 0, simFrames - 1);
    this.sprite.showFrame(this.state, this.frame, simFrames);
    this.sprite.sprite.setPosition(FX, FY).setDepth(9);

    const g = this.overlay;
    g.clear();
    g.lineStyle(1, 0x445, 1).lineBetween(0, FY, VIEW_WIDTH, FY); // ground reference
    const list = this.editable();
    this.sel = Phaser.Math.Clamp(this.sel, 0, list.length - 1);
    list.forEach((e, i) => {
      const w = toWorld(e.box, FX, FY, 1);
      const selected = i === this.sel;
      g.lineStyle(selected ? 3 : 2, selected ? COL.sel : COL[e.kind], selected ? 1 : 0.7);
      g.fillStyle(COL[e.kind], 0.14);
      g.strokeRect(w.left, w.top, w.right - w.left, w.bottom - w.top);
      g.fillRect(w.left, w.top, w.right - w.left, w.bottom - w.top);
      if (selected) this.drawGizmo(g, w);
    });
    this.syncPanel(list[this.sel]);
  }

  private drawGizmo(g: Phaser.GameObjects.Graphics, w: { left: number; right: number; top: number; bottom: number }): void {
    const cx = (w.left + w.right) / 2, cy = (w.top + w.bottom) / 2;
    if (this.mode === "translate") {
      g.lineStyle(2, 0xff5555, 1).lineBetween(cx, cy, cx + 40, cy); // x axis
      g.lineStyle(2, 0x55ff55, 1).lineBetween(cx, cy, cx, cy - 40); // y axis (up)
    } else {
      g.fillStyle(0xffffff, 1);
      for (const [x, y] of [[w.left, w.top], [w.right, w.top], [w.left, w.bottom], [w.right, w.bottom]] as const) {
        g.fillRect(x - 4, y - 4, 8, 8);
      }
    }
  }

  // --- editing: mutate the live box, persist as a per-frame override, keep validator-safe ---
  private applyDelta(dx: number, dy: number): void {
    const e = this.editable()[this.sel];
    if (!e) return;
    if (this.mode === "translate") { e.box.x += dx; e.box.y += -dy; } // world y-down → local y-up
    else { e.box.w = Math.max(1, e.box.w + dx); e.box.h = Math.max(1, e.box.h - dy); }
    this.commit(e);
  }

  /** Guard edits the whole STANCE, hurt/push/hit edit ONE frame — so a guard edit has to re-assemble
   *  (every frame holds its own clone of the template; a bare redraw would leave the others stale),
   *  while a per-frame edit can just redraw what it already mutated in place. */
  private commit(e: Editable): void {
    if (isGuardKind(e.kind)) {
      persistGuard(this.working, e.kind, e.idx, e.box);
      this.rebuild();
    } else {
      this.persist();
      this.redraw();
    }
  }

  private nudge(dx: number, dy: number): void { this.applyDelta(dx, dy); }

  /** Write the current frame's boxes back into data.overrides so a re-assemble / save reproduces
   *  them. hit[] is only included on attack active frames (validator rejects it elsewhere).
   *  The live boxes come off the ASSEMBLED config, which character-builder has already multiplied by
   *  stats.scale — so divide it back out here or a re-assemble would scale them a second time.
   *  Rounded to 2dp, not to integers: at a fractional scale integer rounding makes the inverse lossy
   *  and the box you just dragged jumps on the next rebuild. */
  private persist(): void {
    const spec = this.fighter.cfg.states[this.state];
    const f = spec.frames[this.frame];
    const copy = (b: Box): Box => toAuthored(b, this.working.stats.scale);
    const entry: FrameOverride = { frame: this.frame, hurt: f.hurt.map(copy), push: copy(f.push) };
    if (f.hit.length) entry.hit = f.hit.map(copy);
    const ov = (this.working.overrides ??= {});
    const listRaw = (ov[this.state] ??= []);
    const existing = listRaw.findIndex((o) => o.frame === this.frame);
    // Preserve any per-frame guard override already on this frame — the Gym doesn't author one, but a
    // hand-authored JSON can, and rebuilding the entry from body fields alone would drop it.
    if (existing >= 0) listRaw[existing] = mergeFrameOverride(listRaw[existing], entry);
    else listRaw.push(entry);
  }

  private setState(s: StateName): void { this.state = s; this.frame = 0; this.sel = 0; this.rebuild(); }

  private bindKeys(): void {
    const kb = this.input.keyboard!;
    const step = (e: KeyboardEvent) => (e.shiftKey ? 10 : 2); // shift = coarse nudge
    kb.on("keydown-Q", () => { this.mode = "translate"; this.redraw(); });
    kb.on("keydown-W", () => { this.mode = "scale"; this.redraw(); });
    kb.on("keydown-TAB", (e: KeyboardEvent) => { e.preventDefault?.(); this.sel = (this.sel + 1) % this.editable().length; this.redraw(); });
    kb.on("keydown-OPEN_BRACKET", () => { this.frame = Math.max(0, this.frame - 1); this.redraw(); });
    kb.on("keydown-CLOSED_BRACKET", () => { this.frame++; this.redraw(); });
    kb.on("keydown-LEFT", (e: KeyboardEvent) => this.nudge(-step(e), 0));
    kb.on("keydown-RIGHT", (e: KeyboardEvent) => this.nudge(step(e), 0));
    kb.on("keydown-UP", (e: KeyboardEvent) => this.nudge(0, -step(e)));
    kb.on("keydown-DOWN", (e: KeyboardEvent) => this.nudge(0, step(e)));
  }

  private bindPointer(): void {
    this.input.on("pointerdown", (p: Phaser.Input.Pointer) => { this.dragging = true; this.lastPtr = { x: p.x, y: p.y }; });
    this.input.on("pointerup", () => { this.dragging = false; });
    this.input.on("pointermove", (p: Phaser.Input.Pointer) => {
      if (!this.dragging) return;
      const dx = p.x - this.lastPtr.x, dy = p.y - this.lastPtr.y;
      this.lastPtr = { x: p.x, y: p.y };
      this.applyDelta(dx, dy);
    });
  }

  // --- DOM sidebar (created here so a production build, which never registers this scene, has no
  //     #gym-panel and no /__gym/save client code) ---
  private buildPanel(): void {
    const panel = document.createElement("div");
    panel.id = "gym-panel";
    panel.style.cssText = "position:fixed;top:8px;right:8px;width:220px;padding:10px;background:#0d1017ee;color:#cfe;font:13px monospace;border:1px solid #345;border-radius:6px;z-index:10";
    const fighterSel = select(Object.keys(this.reg), (v) => this.loadFighter(v));
    const stateSel = select([...STATE_NAMES], (v) => this.setState(v as StateName));
    this.inputs = { x: numRow(panel, "x"), y: numRow(panel, "y"), w: numRow(panel, "w"), h: numRow(panel, "h") };
    for (const k of ["x", "y", "w", "h"] as const) {
      this.inputs[k].addEventListener("input", () => this.applyFromPanel());
    }
    const saveBtn = document.createElement("button");
    saveBtn.textContent = "Save JSON";
    saveBtn.style.cssText = "margin-top:8px;width:100%;padding:6px;cursor:pointer";
    saveBtn.addEventListener("click", () => this.save());
    this.status = document.createElement("span");
    this.status.style.cssText = "display:block;margin-top:6px;color:#8fa";

    panel.prepend(row("state", stateSel));
    panel.prepend(row("fighter", fighterSel));
    panel.append(saveBtn, this.status);
    document.body.appendChild(panel);
    this.panel = panel;
    this.stateSel = stateSel;
    // Without this, arrowing inside a number field also nudges the selected box, and Phaser's global
    // key captures swallow the typing outright.
    this.removeFocusGuard = installFocusGuard(this, panel);
  }
  private stateSel!: HTMLSelectElement;
  private removeFocusGuard?: () => void;

  /** Display at 2dp, not integers: these are ASSEMBLED (already scaled) coordinates, and
   *  applyFromPanel writes back all four fields whenever any one is edited — so rounding the display
   *  to integers would quietly re-author the three untouched fields at a fractional scale
   *  (56 → 72.8 → shows 73 → saves 73/1.3 = 56.15). Matches persist()'s 2dp inverse. */
  private syncPanel(e: Editable | undefined): void {
    if (!e) return;
    const disp = (n: number): string => String(Math.round(n * 100) / 100);
    this.inputs.x.value = disp(e.box.x);
    this.inputs.y.value = disp(e.box.y);
    this.inputs.w.value = disp(e.box.w);
    this.inputs.h.value = disp(e.box.h);
    if (this.stateSel.value !== this.state) this.stateSel.value = this.state;
  }

  private applyFromPanel(): void {
    const e = this.editable()[this.sel];
    if (!e) return;
    e.box.x = num(this.inputs.x.value, e.box.x);
    e.box.y = num(this.inputs.y.value, e.box.y);
    e.box.w = Math.max(1, num(this.inputs.w.value, e.box.w));
    e.box.h = Math.max(1, num(this.inputs.h.value, e.box.h));
    this.commit(e);
  }

  private async save(): Promise<void> {
    this.rawFile[this.id].data = JSON.parse(JSON.stringify(this.working));
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

