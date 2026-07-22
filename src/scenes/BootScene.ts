import * as Phaser from "phaser";
import { loadRegistry, eachSheet, textureKey } from "../render/characters";

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

    const keys: string[] = [];
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
    }

    this.load.once(Phaser.Loader.Events.COMPLETE, () => {
      // Phaser fires COMPLETE even when files 404'd (FILE_LOAD_ERROR) AND when an HTTP-200 file is
      // corrupt/undecodable (a process error, no FILE_LOAD_ERROR). Refuse to route a broken match on
      // either — check the transport failures AND that every expected texture actually registered.
      const missing = keys.filter((k) => !this.textures.exists(k));
      if (failed.length || missing.length) {
        throw new Error(`characters: spritesheets failed — load errors: [${failed.join(", ")}]; missing textures: [${missing.join(", ")}]`);
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
