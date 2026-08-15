"""Prepare the ImageGen combat atlases for the runtime.

Only grid slicing and nearest-neighbor resizing are performed; all visible art
comes from the original ImageGen PNGs stored beside this script in source/.
"""

from pathlib import Path
from shutil import copyfile

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = Path(__file__).resolve().parent / "source"
PIXEL_ROOT = ROOT / "public" / "textures" / "pixel"


def fit_tile(source: Image.Image, size: int = 256, padding: int = 10) -> Image.Image:
    alpha_bounds = source.getchannel("A").getbbox()
    if alpha_bounds is None:
        return Image.new("RGBA", (size, size), (0, 0, 0, 0))
    subject = source.crop(alpha_bounds)
    available = size - padding * 2
    scale = min(available / subject.width, available / subject.height)
    resized = subject.resize(
        (max(1, round(subject.width * scale)), max(1, round(subject.height * scale))),
        Image.Resampling.NEAREST,
    )
    tile = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    tile.alpha_composite(resized, ((size - resized.width) // 2, (size - resized.height) // 2))
    return tile


def prepare_atlas(
    source_name: str,
    output_folder: str,
    names: list[str],
    regions: list[tuple[float, float, float, float]] | None = None,
) -> None:
    source = Image.open(SOURCE_ROOT / source_name).convert("RGBA")
    if len(names) != 8:
        raise ValueError("Combat atlases must contain exactly eight cells")

    output = PIXEL_ROOT / output_folder
    output.mkdir(parents=True, exist_ok=True)

    runtime_atlas = Image.new("RGBA", (1024, 512), (0, 0, 0, 0))

    for index, name in enumerate(names):
        if regions is None:
            column = index % 4
            row = index // 4
            region = (column / 4, row / 2, (column + 1) / 4, (row + 1) / 2)
        else:
            region = regions[index]
        left, top, right, bottom = (
            round(region[0] * source.width),
            round(region[1] * source.height),
            round(region[2] * source.width),
            round(region[3] * source.height),
        )
        tile = fit_tile(source.crop((left, top, right, bottom)))
        tile.save(output / f"{name}-pixel-v1.png", optimize=True)
        runtime_atlas.alpha_composite(tile, ((index % 4) * 256, (index // 4) * 256))

    runtime_atlas.save(output / f"{output_folder}-atlas-v1.png", optimize=True)


prepare_atlas(
    "gore-atlas-imagegen-v1.png",
    "gore",
    ["droplets", "impact", "splat-medium", "splat-large", "pool", "smear", "chunks", "dried"],
)

prepare_atlas(
    "weapons-atlas-imagegen-v1.png",
    "weapons",
    ["pistol", "shotgun", "rifle", "knife", "machete", "axe", "spear"],
    regions=[
        (0.00, 0.00, 0.225, 0.48),
        (0.225, 0.00, 0.497, 0.48),
        (0.50, 0.00, 0.765, 0.48),
        (0.78, 0.00, 1.00, 0.48),
        (0.00, 0.52, 0.245, 1.00),
        (0.25, 0.52, 0.50, 1.00),
        (0.51, 0.52, 0.76, 1.00),
        (0.77, 0.52, 1.00, 1.00),
    ],
)

# Stable semantic names consumed by the runtime systems. These are exact copies
# of ImageGen-derived tiles, not synthetic replacements.
gore_aliases = {
    "blood-droplet-pixel-v2.png": "droplets-pixel-v1.png",
    "blood-splat-a-pixel-v2.png": "impact-pixel-v1.png",
    "blood-splat-b-pixel-v2.png": "splat-medium-pixel-v1.png",
    "blood-splat-c-pixel-v2.png": "splat-large-pixel-v1.png",
    "blood-chunk-pixel-v2.png": "chunks-pixel-v1.png",
    "hit-flash-pixel-v2.png": "impact-pixel-v1.png",
}
for destination, source in gore_aliases.items():
    copyfile(PIXEL_ROOT / "gore" / source, PIXEL_ROOT / "gore" / destination)

for weapon_name in ["pistol", "shotgun", "rifle", "knife", "machete", "axe", "spear"]:
    copyfile(
        PIXEL_ROOT / "weapons" / f"{weapon_name}-pixel-v1.png",
        PIXEL_ROOT / "weapons" / f"{weapon_name}-pixel-v2.png",
    )
