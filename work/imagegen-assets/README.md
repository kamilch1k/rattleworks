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

The full-resolution material and map atlases live in `source/`. The shop atlas
is used directly by the HUD at `public/textures/pixel/shop-categories-v2.png`.
`crop_atlases.py` slices the sources into nearest-neighbor runtime tiles.
`crop_combat_atlases.py` prepares the transparent combat decals and weapon
icons while preserving their generated pixels and alpha channel.
