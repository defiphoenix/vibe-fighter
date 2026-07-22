import * as Phaser from "phaser";

// Shared DOM sidebar plumbing for the two DEV-only tuning scenes (Character Gym, Playground).
// Function declarations only — NO top-level DOM or fetch execution — so importing this module can
// never pull panel/save behaviour into a production bundle. main.ts registers both dev scenes under
// import.meta.env.DEV, and vite/gym-save-plugin.ts is `apply: "serve"`, so neither exists in a build.

export function num(v: string, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function labelEl(text: string): HTMLLabelElement {
  const l = document.createElement("label");
  l.textContent = text + " ";
  l.style.cssText = "display:inline-block;width:80px";
  return l;
}

export function row(label: string, el: HTMLElement): HTMLDivElement {
  const d = document.createElement("div");
  d.style.cssText = "margin-bottom:6px";
  d.append(labelEl(label), el);
  return d;
}

export function numRow(parent: HTMLElement, label: string): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "number";
  inp.style.cssText = "width:96px";
  parent.append(row(label, inp));
  return inp;
}

export function checkRow(parent: HTMLElement, label: string, onChange: (v: boolean) => void): HTMLInputElement {
  const inp = document.createElement("input");
  inp.type = "checkbox";
  inp.addEventListener("change", () => onChange(inp.checked));
  parent.append(row(label, inp));
  return inp;
}

export function select(options: string[], onChange: (v: string) => void): HTMLSelectElement {
  const s = document.createElement("select");
  s.style.cssText = "width:110px";
  for (const o of options) {
    const opt = document.createElement("option");
    opt.value = o;
    opt.textContent = o;
    s.append(opt);
  }
  s.addEventListener("change", () => {
    onChange(s.value);
    // Hand control back to the game. Picking from the dropdown leaves the <select> focused, so the
    // focus guard's keyboard-disable stays active and the just-selected fighter is unresponsive to
    // A/D/F/G until the user clicks the canvas — which reads as "this character can't move". Blurring
    // fires focusout, and installFocusGuard re-enables the keyboard on that.
    s.blur();
  });
  return s;
}

/** `top` lets a scene that draws a HUD push the card below it — the Playground's P2 health bar sits
 *  at the top-right of the canvas and was half-covered at 8px. */
export function panelCard(id: string, title: string, top = "8px"): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = id;
  panel.style.cssText =
    `position:fixed;top:${top};right:8px;width:240px;padding:10px;background:#0d1017ee;color:#cfe;` +
    "font:13px monospace;border:1px solid #345;border-radius:6px;z-index:10";
  const h = document.createElement("div");
  h.textContent = title;
  h.style.cssText = "margin-bottom:8px;color:#8fa";
  panel.append(h);
  return panel;
}

/** POST the whole registry to the dev-only Vite middleware (validated + written atomically there). */
export async function saveRegistry(rawFile: unknown): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch("/__gym/save", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(rawFile),
    });
    const body = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    // A 404 here is not a mystery status code — the endpoint is `apply: "serve"`, so it exists ONLY
    // under `npm run dev`. Say that, instead of surfacing a bare "404" that reads like the fighter
    // or the file went missing.
    if (res.status === 404) return { ok: false, error: "save endpoint unavailable — dev server only (npm run dev)" };
    if (!res.ok) return { ok: false, error: body?.error ?? `HTTP ${res.status}` };
    // A 2xx alone is not success: any non-JSON or half-written response would otherwise report
    // "saved ✓" while nothing reached the disk. The middleware answers {ok:true}; require it.
    if (!body?.ok) return { ok: false, error: "unexpected response from the save endpoint" };
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Stop a DOM panel and the game from fighting over the keyboard.
 *
 * Two separate problems, both fixed here:
 *  1. Typing must not drive the fighter — `keyboard.enabled = false` stops key state updates, and
 *     `resetKeys()` releases anything currently latched down so a key released over the panel can't
 *     strand an `isDown`.
 *  2. The game must not eat the typing — `InputReader` builds its keys with `kb.addKey(code)`, whose
 *     `enableCapture` defaults to TRUE, and Phaser's KeyboardManager listens on `window` and calls
 *     preventDefault() on any captured keyCode REGARDLESS of event target. Without
 *     `disableGlobalCapture()`, typing `a`/`d`/`w` into a panel input is swallowed outright.
 *
 * Clicking the canvas blurs the field and restores both.
 *
 * ponytail: scoped to ONE dev scene at a time — `enabled` is per-plugin but global capture is
 * per-game, so two simultaneously-running panels could re-enable each other's keys. Boot routes to
 * exactly one dev scene, so this can't happen through `?scene=`; make the capture refcounted if a
 * scene ever launches another one in parallel.
 */
export function installFocusGuard(scene: Phaser.Scene, panel: HTMLElement): () => void {
  const kb = scene.input.keyboard;
  if (!kb) return () => {};

  const release = (): void => {
    kb.enabled = false;
    kb.resetKeys();
    kb.disableGlobalCapture();
  };
  const restore = (): void => {
    const active = document.activeElement;
    if (active instanceof HTMLElement && panel.contains(active)) active.blur();
    kb.enableGlobalCapture();
    kb.enabled = true;
  };

  panel.addEventListener("focusin", release);
  // focusout also covers tabbing/clicking out of the panel without touching the canvas.
  panel.addEventListener("focusout", restore);
  scene.input.on(Phaser.Input.Events.POINTER_DOWN, restore);

  return () => {
    panel.removeEventListener("focusin", release);
    panel.removeEventListener("focusout", restore);
    scene.input.off(Phaser.Input.Events.POINTER_DOWN, restore);
    restore();
  };
}
