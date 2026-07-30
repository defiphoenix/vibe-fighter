import * as Phaser from "phaser";
import { loadRegistry, eachSheet, textureKey } from "../render/characters";
import { PAD_ATLAS } from "../render/touch";

const STAGES = ["twilight", "sunset"];
const LAYERS = ["far", "medium", "main", "near"];

/** Preloads stage assets + the character registry, then a SECOND pass preloads every fighter
 *  spritesheet named in character-gym.json before handing off to the chosen scene.
 *  ponytail: stage layers are hardcoded (2 stages x 4 layers) — a data-driven loader lands if the
 *  stage roster grows; character sheets are already fully data-driven from the registry. */
export class BootScene extends Phaser.Scene {
  constructor() {
    super("Boot");
  }

  preload(): void {
    // Phase 1: configs + stage runtime (URLs relative to Vite web root public/).
    this.load.json("characters", "configs/character-gym.json");
    this.load.json("stages", "configs/stages.json");
    this.load.atlas("twilight-atlas", "props/twilight-atlas.png", "props/twilight-atlas.json");
    this.load.atlas("hud-atlas", "ui/hud-atlas.png", "ui/hud-atlas.json"); // Phase 07 HUD art, skinned in Phase 14
    // Phase 19 touch pad art. Loaded unconditionally (4 frames, 64 KB) rather than behind
    // `touchMode()`: the key assertion in create() is unconditional, and `?touch=1` can turn the pad
    // on in production at any time — a conditional load would 404 exactly then.
    this.load.atlas(PAD_ATLAS, "ui/pad-atlas.png", "ui/pad-atlas.json");
    for (const stage of STAGES) {
      for (const layer of LAYERS) {
        this.load.image(`${stage}-${layer}`, `backgrounds/${stage}/${layer}.png`);
      }
    }
  }

  create(): void {
    // Phase 2: the registry JSON is now cached — validate it (throws fail-fast on a bad file), then
    // queue every declared per-state spritesheet. Loads queued in create() do NOT auto-start.
    const reg = loadRegistry(this.cache.json);
    const failed: string[] = [];
    this.load.on(Phaser.Loader.Events.FILE_LOAD_ERROR, (file: Phaser.Loader.File) => failed.push(file.key));

    // The preload() atlases ride the same guard as everything else: they were queued in the first
    // pass, so by COMPLETE they must have registered. Cheaper to name the file here than to let
    // buildStage/Hud discover it one frame at a time.
    const keys: string[] = ["twilight-atlas", "hud-atlas", PAD_ATLAS];
    for (const { id, state, sheet } of eachSheet(reg)) {
      const key = textureKey(id, state);
      keys.push(key);
      this.load.spritesheet(key, sheet.path, {
        frameWidth: reg[id].render.frameWidth,
        frameHeight: reg[id].render.frameHeight,
      });
    }

    // Select-screen portraits (Phase 11 bakes them: `npm run copy:portraits`). Queued in this pass,
    // not preload(), because the ids come from the registry — which is only cached once preload has
    // run. Riding the same queue means a missing portrait trips the guard below instead of drawing
    // an empty card.
    for (const id of Object.keys(reg)) {
      const key = `portrait-${id}`;
      keys.push(key);
      this.load.image(key, `ui/portraits/${id}.png`);
      // The HUD's own bake: the same bust, cover-cropped to the atlas arch and LANCZOS-resampled to
      // HUD size (`npm run copy:portraits`). The 448x600 card into a ~96x147 slot is a 4.7x bilinear
      // squeeze with no mipmaps (Phaser only mipmaps power-of-two textures), which reads as low-res.
      const hudKey = `hud-portrait-${id}`;
      keys.push(hudKey);
      this.load.image(hudKey, `ui/portraits/hud/${id}.png`);
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // Phaser fires COMPLETE even when files 404'd (FILE_LOAD_ERROR) AND when an HTTP-200 file is
      // corrupt/undecodable (a process error, no FILE_LOAD_ERROR). Refuse to route a broken match on
      // either — check the transport failures AND that every expected texture actually registered.
      const missing = keys.filter((k) => !this.textures.exists(k));
      if (failed.length || missing.length) {
        throw new Error(`boot: assets failed to load (sheets, atlases or portraits) — load errors: [${failed.join(", ")}]; missing textures: [${missing.join(", ")}]`);
      }
      const scene = import.meta.env.DEV ? new URLSearchParams(location.search).get("scene") : null;
      // `match` is in here so DEV can skip the menus (the acceptance specs do); prod always starts
      // at the Play flow, which is the only way to reach a match with a chosen mode/stage/pair.
      const DEV_SCENES: Record<string, string> = {
        preview: "StagePreview", gym: "Gym", playground: "Playground", match: "Match",
      };
      this.scene.start((scene && DEV_SCENES[scene]) || "Flow");
    });
    this.load.start();
  }
}
