import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MatchScene } from "./scenes/MatchScene";
import { FlowScene } from "./scenes/FlowScene";
import { VIEW_WIDTH, STAGE_HEIGHT } from "./sim/constants";
import { StagePreviewScene } from "./scenes/StagePreviewScene";
import { GymScene } from "./scenes/GymScene";
import { PlaygroundScene } from "./scenes/PlaygroundScene";
import { shouldBlockForOrientation, touchMode } from "./render/touch";

// The StagePreview + Gym + Playground dev scenes are registered only in dev, so ?scene=preview /
// ?scene=gym / ?scene=playground can't reach them in a production build (Boot's routing is
// DEV-guarded to match). Only Boot auto-starts.
// FlowScene ships (it is the game's front door); only the tuning scenes are DEV-gated.
const scenes: Phaser.Types.Scenes.SceneType[] = [BootScene, FlowScene, MatchScene];
if (import.meta.env.DEV) scenes.push(StagePreviewScene, GymScene, PlaygroundScene);

const game = new Phaser.Game({
  type: Phaser.AUTO,
  width: VIEW_WIDTH, // camera/canvas width — the world (STAGE_WIDTH) is wider and scrolls
  height: STAGE_HEIGHT,
  parent: "game",
  backgroundColor: "#10131a",
  // No pixelArt: fighters are video-derived frames and backgrounds are painted art (both
  // photographic) — default LINEAR filtering avoids the shimmer NEAREST gives under Scale.FIT.
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
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

// FIRST call rides PRE_STEP, not the boot line above: `TimeStep.sleep()` is a no-op unless the loop
// is already `running`, and `Game.start()` calls `loop.start()` after READY — so a boot that is
// already in portrait would set the class and never actually pause.
game.events.once(Phaser.Core.Events.PRE_STEP, applyOrientation);
window.addEventListener("resize", applyOrientation);
window.addEventListener("orientationchange", applyOrientation);
// iOS Safari does not reliably fire the other two when its toolbars move.
window.visualViewport?.addEventListener("resize", applyOrientation);
