"""Build the runtime face atlas from the four authored ImageGen sources.

This script only resizes and packs the generated bitmap artwork. It does not
draw or synthesize any face pixels, keeping the shipped expressions traceable
to the retained ImageGen source files.
"""

from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SOURCE = Path(__file__).resolve().parent / "source" / "character-faces"
OUTPUT = ROOT / "public" / "textures" / "pixel" / "characters" / "funny-faces-pixel-v1.png"
CELL_SIZE = 256

FACES = (
    "human-goofy-imagegen-v1.png",
    "human-angry-imagegen-v1.png",
    "zombie-angry-imagegen-v1.png",
    "zombie-troll-imagegen-v1.png",
)


def main() -> None:
    atlas = Image.new("RGBA", (CELL_SIZE * 2, CELL_SIZE * 2), (0, 0, 0, 0))
    for index, filename in enumerate(FACES):
        source_path = SOURCE / filename
        with Image.open(source_path) as source:
            face = source.convert("RGBA").resize(
                (CELL_SIZE, CELL_SIZE),
                Image.Resampling.NEAREST,
            )
        x = (index % 2) * CELL_SIZE
        y = (index // 2) * CELL_SIZE
        atlas.alpha_composite(face, (x, y))

    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    atlas.save(OUTPUT, format="PNG", optimize=True)
    print(f"Wrote {OUTPUT.relative_to(ROOT)} ({atlas.width}x{atlas.height}, RGBA)")


if __name__ == "__main__":
    main()
