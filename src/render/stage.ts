import * as Phaser from "phaser";

/** One parallax layer of a stage. `key` is the loaded texture id ('<stageId>-<layer>'). */
export interface LayerConfig {
  key: string;
  scrollFactor: number;
  depth: number;
  occludesFighters: boolean;
}

/** One animated prop. `atlasFrame` is the twilight-atlas prefix ('<frame>-0..3'). */
export interface PropConfig {
  atlasFrame: string;
  x: number;
  y: number;
  depth: number;
  /** Uniform sprite scale (default 1 = native atlas-frame size). No scrollFactor knob: a prop
   *  factor < 1 drifts across the roof as the camera pans, so props stay glued at the default 1. */
  scale?: number;
}

export interface StageConfig {
  layers: LayerConfig[];
  props: PropConfig[];
}

/** Whole stages.json shape: { "<stageId>": StageConfig }. `_doc` is a comment key, ignored. */
export type StagesFile = Record<string, StageConfig>;

const PROP_ATLAS = "twilight-atlas";
const PROP_FRAMES = 4; // each prop is a 4-frame loop, per public/props/twilight-atlas.json

/** A built stage's handle: the layer images (for camera/e2e inspection) + a teardown that destroys
 *  every GameObject it created (layers + props). */
export interface StageHandle {
  layers: Phaser.GameObjects.Image[];
  /** EVERY object the stage created — layers AND props. `layers` alone is not enough for a caller
   *  that must partition the scene between cameras: a prop left out of the world camera's ignore
   *  list renders on the UI camera too. */
  objects: Phaser.GameObjects.GameObject[];
  destroy(): void;
}

/** Build a stage's parallax layers + animated props into a scene, returning a destroy handle so a
 *  caller (the preview scene) can rebuild cleanly on a stage switch. Fails fast on any missing
 *  texture or atlas frame rather than letting Phaser draw a green placeholder. */
export function buildStage(scene: Phaser.Scene, cfg: StageConfig): StageHandle {
  const objects: Phaser.GameObjects.GameObject[] = [];
  const layers: Phaser.GameObjects.Image[] = [];

  // Validate EVERYTHING up front — every layer texture and all 4 frames of every prop — before
  // creating a single object. Phaser silently skips a missing later anim frame rather than throwing,
  // and validating mid-build would leave earlier objects orphaned (no handle to destroy) on a throw.
  const atlasTex = scene.textures.get(PROP_ATLAS);
  for (const layer of cfg.layers) {
    if (!scene.textures.exists(layer.key)) {
      throw new Error(`stage: missing layer texture "${layer.key}"`);
    }
  }
  for (const prop of cfg.props) {
    for (let i = 0; i < PROP_FRAMES; i++) {
      const fr = `${prop.atlasFrame}-${i}`;
      if (!atlasTex || !atlasTex.has(fr)) {
        throw new Error(`stage: missing prop frame "${fr}" in atlas "${PROP_ATLAS}"`);
      }
    }
  }

  for (const layer of cfg.layers) {
    // Layers are pre-baked to the runtime size (1697x720), so no scaling — origin (0,0) at world 0.
    const img = scene.add
      .image(0, 0, layer.key)
      .setOrigin(0, 0)
      .setScale(1)
      .setScrollFactor(layer.scrollFactor)
      .setDepth(layer.depth);
    objects.push(img);
    layers.push(img);
  }

  for (const prop of cfg.props) {
    const first = `${prop.atlasFrame}-0`;
    const animKey = `prop-${prop.atlasFrame}`;
    if (!scene.anims.exists(animKey)) {
      scene.anims.create({
        key: animKey,
        frames: scene.anims.generateFrameNames(PROP_ATLAS, {
          prefix: `${prop.atlasFrame}-`,
          start: 0,
          end: PROP_FRAMES - 1,
        }),
        frameRate: 12,
        repeat: -1,
      });
    }
    const sprite = scene.add
      .sprite(prop.x, prop.y, PROP_ATLAS, first)
      .setOrigin(0.5, 1)
      .setScale(prop.scale ?? 1)
      .setDepth(prop.depth)
      .play(animKey);
    objects.push(sprite);
  }

  return {
    layers,
    objects,
    destroy() {
      for (const o of objects) o.destroy();
      objects.length = 0;
      layers.length = 0;
    },
  };
}
