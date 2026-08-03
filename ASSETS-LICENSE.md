# Asset License — all rights reserved

The **code** in this repository is MIT-licensed ([LICENSE](LICENSE)). The **art and audio are not.**

Everything under **`public/`** and **`concepts/`** is proprietary. All rights reserved.

That includes:

- `public/sprites/` — the fighter animation sheets
- `public/backgrounds/` — the parallax stage layers
- `public/ui/` — portraits, HUD atlas, touch-pad atlas
- `public/props/` — the animated stage props
- `public/audio/` — every sound cue and music bed
- `concepts/` — the authoring masters and the prompts that produced them

**You may not** copy, redistribute, or reuse these assets in your own project, commercially or
otherwise, without written permission. Reading the repository, running the game locally, and reusing
the *code* under the MIT license are all fine.

Every asset was generated in-house for this project — no third-party asset pack, no stock library, no
royalty-free audio anywhere in it. Per-asset provenance, tooling and processing is recorded in
[`docs/asset-manifest.md`](docs/asset-manifest.md).

Note that `.gitignore` excludes the raw masters (`concepts/**/*.png|gif|wav|mp3|flac`), so a clone
carries the shipped, runtime-sized assets under `public/` but not the authoring originals.

If you want to use something here, ask.
