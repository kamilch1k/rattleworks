# ImageGen pixel-art asset set

These are original bitmap assets generated for Rattleworks with the built-in
ImageGen skill. Runtime code does not procedurally synthesize their artwork.

## Prompt set

1. Original seamless 16-bit pixel-art material atlas in an exact 4x4 grid:
   wood planks, bolted metal, aggregate concrete, aqua glass, black rubber,
   orange plastic, dirt, coral toy fabric, denim, leather, mossy stone, brick,
   hazard stripes, factory plate, grass, and snow. Crisp square pixels, no text,
   logos, gradients, perspective, or photorealism.
2. Original seamless 16-bit pixel-art environment atlas in an exact 3x2 grid:
   bright grass, warm soil, sunny sand, cracked concrete, dark factory panels,
   and a blue night grid. Top-down tileable surfaces, crisp square pixels, no
   text, logos, perspective, or photorealism.
3. Original 16-bit pixel-art item-shop category atlas in an exact 3x2 grid:
   characters, structures, props, machines, destruction, and blueprints.
   Chunky blue inventory cards, transparent outside the cards, no words or logos.
4. Original 16-bit pixel-art gore decal atlas in an exact 4x2 grid: droplets,
   impact splatter, medium and large splats, a pool, smear, blocky fragments,
   and a dried stain. Crimson/burgundy palette, transparent background, no
   anatomy, people, text, logos, or photorealism.
5. Original 16-bit pixel-art weapon icon atlas in an exact 4x2 grid: pistol,
   pump shotgun, blocky rifle, knife, machete, fire axe, spear, and ammunition
   box. Generic original designs, transparent background, no brands or copied
   game assets.
6. Four original transparent 32x32-style face decals, generated separately:
   a goofy human with one squint and a crooked grin, a furious human with red
   eyes and clenched teeth, an angry jaundiced zombie with an uneven mouth, and
   a troll-zombie with mismatched eyes and a snaggletooth grin. Every prompt
   required isolated hard-edged facial pixels, genuine alpha transparency, no
   filled head silhouette, text, logo, watermark, realistic anatomy, or copied
   character design.
7. Original 2x2 chapter-one level-card atlas: a heavy ball hitting a flimsy hut,
   a wooden tower on tiny feet, red barrels bursting beside a concrete wall,
   and three colorful houses toppling like dominoes. The prompt required equal
   center-safe panels, sunny scrapyard backdrops, rectangular voxel characters,
   crisp 16-bit pixels, and no text, brands, watermarks, copied art, or gore.
8. Original 2x2 chapter-two level-card atlas: a spring-powered target range, a
   wrecking ball swinging into a workshop frame, a homemade delivery cart
   hitting a depot, and a bridge folding around block characters. The prompt
   required equal center-safe panels, chunky toy materials, crisp 16-bit pixels,
   and no text, brands, watermarks, copied art, or sausage-shaped characters.
9. Original 2x2 chapter-three level-card atlas: a moonlit castle under cannon
   fire, an industrial chain reaction, a seven-storey tower buckling at its
   feet, and a linked house/tower/skywalk/factory finale. The prompt required
   equal center-safe panels, dramatic but playful lighting, crisp 16-bit pixels,
   and no text, brands, watermarks, copied art, or detailed gore.

The full-resolution material and map atlases live in `source/`. The shop atlas
is used directly by the HUD at `public/textures/pixel/shop-categories-v2.png`.
`crop_atlases.py` slices the sources into nearest-neighbor runtime tiles.
`crop_combat_atlases.py` prepares the transparent combat decals and weapon
icons while preserving their generated pixels and alpha channel.
`build_character_faces.py` nearest-resizes and packs the four retained sources
under `source/character-faces/` into the 2x2 runtime atlas at
`public/textures/pixel/characters/funny-faces-pixel-v1.png`; it draws no new
artwork.

The three full-resolution level-card atlases were generated with OpenAI's
built-in ImageGen tool on 2026-08-15 and are retained under
`source/level-thumbnails/`. `crop_level_thumbnails.py` deterministically slices
the equal 2x2 grids, removes their thin gutters, center-crops to 16:9, and uses
nearest-neighbor resizing to produce the twelve 512x288 runtime PNGs under
`public/textures/pixel/levels/`. It draws no additional artwork.
