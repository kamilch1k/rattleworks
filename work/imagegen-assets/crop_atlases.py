"""Crop the approved ImageGen atlases into runtime-ready pixel texture tiles.

This script performs only lossless atlas slicing and nearest-neighbor resizing.
The source artwork remains in public/textures/pixel/source for provenance.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
PIXEL_ROOT = ROOT / "public" / "textures" / "pixel"
SOURCE_ROOT = Path(__file__).resolve().parent / "source"


def crop_grid(
    source: Path,
    output_dir: Path,
    names: list[str],
    columns: int,
    rows: int,
    size: tuple[int, int] = (256, 256),
) -> None:
    image = Image.open(source).convert("RGBA")
    if len(names) != columns * rows:
        raise ValueError("Every atlas cell must have a name")

    output_dir.mkdir(parents=True, exist_ok=True)
    for index, name in enumerate(names):
        column = index % columns
        row = index // columns
        left = round(column * image.width / columns)
        top = round(row * image.height / rows)
        right = round((column + 1) * image.width / columns)
        bottom = round((row + 1) * image.height / rows)
        tile = image.crop((left, top, right, bottom)).resize(
            size,
            Image.Resampling.NEAREST,
        )
        tile.save(output_dir / f"{name}-pixel-v2.png", optimize=True)


crop_grid(
    SOURCE_ROOT / "materials-atlas-imagegen-v2.png",
    PIXEL_ROOT / "materials",
    [
        "wood",
        "metal",
        "concrete",
        "glass",
        "rubber",
        "plastic",
        "dirt",
        "toy",
        "denim",
        "leather",
        "stone",
        "brick",
        "hazard",
        "factory",
        "grass",
        "snow",
    ],
    columns=4,
    rows=4,
)

# The coral toy-fabric tile is intentionally reused for the fabric surface role.
fabric = Image.open(PIXEL_ROOT / "materials" / "toy-pixel-v2.png")
fabric.save(PIXEL_ROOT / "materials" / "fabric-pixel-v2.png", optimize=True)

crop_grid(
    SOURCE_ROOT / "maps-atlas-imagegen-v2.png",
    PIXEL_ROOT / "maps",
    ["grass", "soil", "sand", "concrete", "factory", "night-grid"],
    columns=3,
    rows=2,
)

crop_grid(
    PIXEL_ROOT / "shop-categories-v2.png",
    PIXEL_ROOT / "ui",
    ["characters", "structures", "props", "machines", "destruction", "blueprints"],
    columns=3,
    rows=2,
)
