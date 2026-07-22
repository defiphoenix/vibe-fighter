import * as Phaser from "phaser";
import { BootScene } from "./scenes/BootScene";
import { MatchScene } from "./scenes/MatchScene";
import { FlowScene } from "./scenes/FlowScene";
import { VIEW_WIDTH, STAGE_HEIGHT } from "./sim/constants";
import { StagePreviewScene } from "./scenes/StagePreviewScene";
import { GymScene } from "./scenes/GymScene";
import { PlaygroundScene } from "./scenes/PlaygroundScene";

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
  },
  scene: scenes,
});

// dev-only testability hook: lets the Playwright acceptance spec pump the loop deterministically
// (game.step) instead of depending on RAF, which headless/occluded windows throttle.
if (import.meta.env.DEV) (window as unknown as { __game: Phaser.Game }).__game = game;
