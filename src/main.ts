import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MatchScene } from "./scenes/MatchScene";
import { FlowScene } from "./scenes/FlowScene";
import { VIEW_WIDTH, STAGE_HEIGHT } from "./sim/constants";
import { StagePreviewScene } from "./scenes/StagePreviewScene";
import { GymScene } from "./scenes/GymScene";
import { PlaygroundScene } from "./scenes/PlaygroundScene";
import { shouldBlockForOrientation, touchMode } from "./render/touch";
import { viewWidthFor, VIEW_WIDTH_DEADBAND } from "./render/viewport";

// The StagePreview + Gym + Playground dev scenes are registered only in dev, so ?scene=preview /
// ?scene=gym / ?scene=playground can't reach them in a production build (Boot's routing is
// DEV-guarded to match). Only Boot auto-starts.
// FlowScene ships (it is the game's front door); only the tuning scenes are DEV-gated.
const scenes: Phaser.Types.Scenes.SceneType[] = [BootScene, FlowScene, MatchScene];
if (import.meta.env.DEV) scenes.push(StagePreviewScene, GymScene, PlaygroundScene);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  // The STARTING camera/canvas width — the world (STAGE_WIDTH) is wider and scrolls. On a screen
  // wider than 16:9 `applyViewport` below reshapes the game to the device's own aspect; this is the
  // floor it starts from and returns to.
  width: VIEW_WIDTH,
  height: STAGE_HEIGHT,
  parent: "game",
  backgroundColor: "#10131a",
  // No pixelArt: fighters are video-derived frames and backgrounds are painted art (both
  // photographic) — default LINEAR filtering avoids the shimmer NEAREST gives under Scale.FIT.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
    // Deliberately NO `min`/`max`. They read as game-size bounds and are not: `parseConfig` maps
    // them onto `displaySize` — the CSS size — and `Size.getNewWidth` clamps to `minWidth` BEFORE
    // comparing to the parent, so `min.width: 1280` writes `style.width: 1280px` onto an 851px phone
    // viewport with a -215px left margin. The width is bounded in `render/viewport.ts` instead.
    // Send the WRAPPER fullscreen, not the canvas. Left to itself Phaser creates a blank <div>, moves
    // only the canvas into it and fullscreens that — which would strand the #rotate overlay outside
    // the fullscreen subtree, so a phone rotated to portrait while fullscreen would show a frozen
    // canvas and nothing else. #game contains both.
    fullscreenTarget: "game",
  },
  scene: scenes,
});

// dev-only testability hook: lets the Playwright acceptance spec pump the loop deterministically
// (game.step) instead of depending on RAF, which headless/occluded windows throttle.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;

// --- Phase 18: touch classification + the rotate gate ---------------------------------------------
//
// The one place either decision is applied to the page. `touchMode()` is memoised, so the class here,
// FlowScene's PvP filter and MatchScene's pad all come from a single evaluation.
document.documentElement.classList.toggle("touch", touchMode());

// --- Phase 19: reshape the GAME to the screen's aspect -------------------------------------------
//
// `Scale.FIT` alone pillarboxes a fixed 16:9 canvas: on a 2.17:1 phone ~18% of the screen was bar.
// Giving the game the device's own aspect (bounded by `render/viewport.ts` to the world's width)
// leaves FIT nothing to letterbox. The HEIGHT never moves — the stage art is exactly STAGE_HEIGHT
// tall, and a taller game would show empty bands and break MatchScene's bottom-aligned `centerOn`.
/** Re-entrancy guard: `setGameSize` ends in `refresh()`, which synchronously emits RESIZE again. */
let applyingViewport = false;

function applyViewport(): void {
  if (applyingViewport) return;
  applyingViewport = true;
  try {
    const s = game.scale;
    // parentSize, NOT the sizes RESIZE hands us: those are game/base/display, and feeding an
    // already-fitted size back through `viewWidthFor` just re-derives the width we already have.
    const want = viewWidthFor(s.parentSize.width, s.parentSize.height);
    // A mobile URL bar sliding changes the viewport a pixel at a time; each one would otherwise be a
    // full HUD + pad + menu relayout.
    if (Math.abs(want - s.gameSize.width) >= VIEW_WIDTH_DEADBAND) s.setGameSize(want, STAGE_HEIGHT);
  } finally {
    applyingViewport = false;
  }
}

/** True only while WE are the reason the loop is asleep — so this can never wake a loop the e2e
 *  harness stopped, or one paused for any other reason. */
let sleptForRotation = false;

function applyOrientation(): void {
  const blocked = shouldBlockForOrientation({
    touch: touchMode(),
    width: window.innerWidth,
    height: window.innerHeight,
  });
  document.documentElement.classList.toggle("rotate", blocked);
  // The overlay alone does NOT stop Phaser seeing the tap. TouchManager registers a WINDOW listener
  // that forwards any touch whose target is not the canvas straight into InputManager
  // (TouchManager.onTouchStartWindow), so a tap on #rotate would still hit the title Zone or a card
  // underneath it. The same listener is gated on `manager.enabled`, which is what this flips.
  if (blocked !== !game.input.enabled) {
    // Drop every live contact ACROSS the transition. While input is disabled Phaser's own guard
    // (`manager.enabled`) throws away the `touchend` for a finger that was already on a pad button, so
    // its Pointer keeps reporting `isDown` — and `TouchPad.consume`'s reconciliation believes it. The
    // button would then be held forever after rotating back. `Pointer.reset()` clears `isDown`.
    for (const p of game.input.pointers) p.reset();
  }
  game.input.enabled = !blocked;
  if (blocked) {
    if (game.loop.running) {
      game.loop.sleep();
      sleptForRotation = true;
    }
  } else if (sleptForRotation) {
    game.loop.wake();
    sleptForRotation = false;
  }
}

// Every path Phaser has — its own window-resize listener, orientationchange, entering and leaving
// fullscreen, and the 500 ms parent-bounds poll — ends in `refresh()`, which emits RESIZE. So one
// subscription covers all of them, including while the loop is asleep behind the rotate overlay
// (those are plain DOM handlers and do not go through the TimeStep).
game.scale.on(Phaser.Scale.Events.RESIZE, applyViewport);

// FIRST calls ride PRE_STEP, not the boot lines above, for two INDEPENDENT reasons:
//
//  * applyOrientation: `TimeStep.sleep()` is a no-op unless the loop is already `running`, and
//    `Game.start()` calls `loop.start()` after READY — so a boot that is already in portrait would
//    set the class and never actually pause.
//  * applyViewport: DEFENSIVE, and honestly labelled as such. ScaleManager calls `refresh()` inside
//    `boot()` and again on READY, both before this module can subscribe, and afterwards its poll
//    only refreshes when the parent size has actually CHANGED — so in principle a device that opens
//    in landscape and is left alone could emit no further RESIZE and strand the game at 1280.
//    MEASURED: that is not what happens under Chromium's phone emulation, where the parent goes
//    0 -> real during startup and the poll fires anyway; removing this line left every acceptance
//    case green. It is kept because correctness should not depend on that accident of timing, and it
//    costs one idempotent call. Do NOT claim a test covers it — none does.
//
// PRE_STEP runs before any scene's `create()` (Boot's own create waits on the loader), so scenes are
// built at the final width and their initial `layout()` reads the right number first time.
game.events.once(Phaser.Core.Events.PRE_STEP, () => {
  applyViewport();
  applyOrientation();
});
window.addEventListener("resize", applyOrientation);
window.addEventListener("orientationchange", applyOrientation);
// iOS Safari does not reliably fire the other two when its toolbars move.
window.visualViewport?.addEventListener("resize", applyOrientation);
