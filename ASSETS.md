# Asset and license record

Rattleworks contains no downloaded third-party art, models, fonts, music, or sound-effect files.

## Original procedural content

- All characters, structures, props, machines, particles, and scenery are assembled at runtime from original Three.js primitive geometry.
- All interface graphics are original HTML/CSS shapes and typography treatments using system fonts.
- All audio is synthesized at runtime by the original Web Audio code in `src/game/AudioSystem.ts`.
- Campaign layouts, names, copy, mechanics, palettes, and character designs are original to this project.

## Original generated character textures

The following seamless material textures were generated specifically for this
project with OpenAI's built-in image-generation tool on 2026-08-14, then
downsampled to 256×256 PNG files for efficient browser use. They contain no
third-party logos, text, characters, or copied game assets.

- `public/textures/characters/fabric.png` — woven cotton
- `public/textures/characters/denim.png` — stylized denim twill
- `public/textures/characters/leather.png` — clean pebbled leather
- `public/textures/characters/metal.png` — hammered toy armor metal

## Original generated pixel-art packs

The pixel material tiles, map tiles, shop/category panels, weapon cutouts, and
gore sprites under `public/textures/pixel/` were generated specifically for
Rattleworks with OpenAI's built-in image-generation tool on 2026-08-14. The
source atlases and deterministic crop scripts are retained under
`work/imagegen-assets/`. These assets contain no third-party logos, text, or
copied game artwork.

Four transparent, funny pixel-face decals were also generated individually for
the block characters and packed into
`public/textures/pixel/characters/funny-faces-pixel-v1.png`. The top row contains
goofy and angry human expressions; the bottom row contains angry and troll-like
zombie expressions. Full-resolution generated sources and the deterministic
packing script are retained under `work/imagegen-assets/`.

Three original wide pixel-art panoramas provide chapter-specific sky domes:

- `public/textures/pixel/sky/backyard-sky-pixel-v1.png` — bright suburban scrapyard day
- `public/textures/pixel/sky/industrial-sky-pixel-v1.png` — violet-orange factory dusk
- `public/textures/pixel/sky/castle-sky-pixel-v1.png` — moonlit storm and distant battlements

Twelve original 512x288 pixel-art campaign illustrations under
`public/textures/pixel/levels/` depict the authored mission setups from
"Knock Knock" through "EVERYTHING MUST GO." OpenAI's built-in ImageGen tool
generated three source atlases on 2026-08-15 from chapter-specific prompts for
the hut, weak-foot tower, explosive wall, domino houses, spring range,
wrecking rig, delivery cart, bridge, castle, factory, tall tower, and linked
finale arena. The prompts required original hard-edged 16-bit pixel art,
rectangular voxel characters, equal center-safe panels, and no text, logos,
watermarks, brands, copied game art, or detailed gore. Full-resolution sources
are retained in `work/imagegen-assets/source/level-thumbnails/`; the deterministic
`work/imagegen-assets/crop_level_thumbnails.py` script only slices, center-crops,
and nearest-resizes those generated pixels.

## Runtime libraries

- Three.js — MIT License
- Rapier (`@dimforge/rapier3d`) — Apache-2.0 License
- Vite and build plugins — MIT License
- TypeScript — Apache-2.0 License

Library license files are included by npm in their respective `node_modules` packages during development. No library code is represented as a game asset.
