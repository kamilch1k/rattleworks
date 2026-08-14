"""Prepare the ImageGen campaign-item atlas for the runtime.

Only equal-grid slicing, transparent-bound fitting, and nearest-neighbor
resizing are performed. All visible artwork comes from the retained ImageGen
source PNG.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = (
    Path(__file__).resolve().parent
    / "source"
    / "campaign-items"
    / "campaign-projectiles-atlas-imagegen-v1.png"
)
OUTPUT = ROOT / "public" / "textures" / "pixel" / "items"
NAMES = [
    "concrete-block",
    "heavy-ball",
    "metal-ball",
    "bouncy-ball",
    "bomb",
    "explosive-projectile",
    "rocket",
    "spring",
]


def fit_tile(source: Image.Image, size: int = 256, padding: int = 12) -> Image.Image:
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


def main() -> None:
    source = Image.open(SOURCE).convert("RGBA")
    OUTPUT.mkdir(parents=True, exist_ok=True)

    for index, name in enumerate(NAMES):
        column = index % 4
        row = index // 4
        bounds = (
            round(column * source.width / 4),
            round(row * source.height / 2),
            round((column + 1) * source.width / 4),
            round((row + 1) * source.height / 2),
        )
        fit_tile(source.crop(bounds)).save(OUTPUT / f"{name}-pixel-v1.png", optimize=True)


if __name__ == "__main__":
    main()
