"""Build campaign level-card thumbnails from the retained ImageGen atlases.

The source files contain four equal panels in reading order. This script only
slices those panels, removes the thin atlas gutters, center-crops to 16:9, and
nearest-neighbor resizes to the runtime card size. It draws no new artwork.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE_ROOT = Path(__file__).resolve().parent / "source" / "level-thumbnails"
OUTPUT_ROOT = ROOT / "public" / "textures" / "pixel" / "levels"
OUTPUT_SIZE = (512, 288)
TARGET_ASPECT = OUTPUT_SIZE[0] / OUTPUT_SIZE[1]
CELL_INSET_FRACTION = 0.008


ATLASES: tuple[tuple[str, tuple[str, str, str, str]], ...] = (
    (
        "chapter-01-levels-01-04-imagegen-v1.png",
        (
            "level-01-knock-knock-pixel-v1.png",
            "level-02-bad-foundation-pixel-v1.png",
            "level-03-barrel-trouble-pixel-v1.png",
            "level-04-domino-house-pixel-v1.png",
        ),
    ),
    (
        "chapter-02-levels-05-08-imagegen-v1.png",
        (
            "level-05-spring-cleaning-pixel-v1.png",
            "level-06-wrecking-ball-pixel-v1.png",
            "level-07-delivery-problem-pixel-v1.png",
            "level-08-bridge-disaster-pixel-v1.png",
        ),
    ),
    (
        "chapter-03-levels-09-12-imagegen-v1.png",
        (
            "level-09-castle-crash-pixel-v1.png",
            "level-10-factory-accident-pixel-v1.png",
            "level-11-tower-trouble-pixel-v1.png",
            "level-12-everything-must-go-pixel-v1.png",
        ),
    ),
)


def center_crop_to_aspect(image: Image.Image, target_aspect: float) -> Image.Image:
    current_aspect = image.width / image.height
    if current_aspect > target_aspect:
        width = round(image.height * target_aspect)
        left = (image.width - width) // 2
        return image.crop((left, 0, left + width, image.height))

    height = round(image.width / target_aspect)
    top = (image.height - height) // 2
    return image.crop((0, top, image.width, top + height))


def build_atlas(source_name: str, output_names: tuple[str, str, str, str]) -> None:
    source_path = SOURCE_ROOT / source_name
    source = Image.open(source_path).convert("RGBA")

    for index, output_name in enumerate(output_names):
        column = index % 2
        row = index // 2
        left = round(column * source.width / 2)
        top = round(row * source.height / 2)
        right = round((column + 1) * source.width / 2)
        bottom = round((row + 1) * source.height / 2)

        cell = source.crop((left, top, right, bottom))
        inset_x = max(1, round(cell.width * CELL_INSET_FRACTION))
        inset_y = max(1, round(cell.height * CELL_INSET_FRACTION))
        cell = cell.crop((inset_x, inset_y, cell.width - inset_x, cell.height - inset_y))
        card = center_crop_to_aspect(cell, TARGET_ASPECT).resize(
            OUTPUT_SIZE,
            Image.Resampling.NEAREST,
        )
        card.save(OUTPUT_ROOT / output_name, optimize=True)


def main() -> None:
    OUTPUT_ROOT.mkdir(parents=True, exist_ok=True)
    for source_name, output_names in ATLASES:
        build_atlas(source_name, output_names)


if __name__ == "__main__":
    main()
