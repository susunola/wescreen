#!/usr/bin/env python3
"""Regenerate every Microsoft Edge Add-ons store asset from the repo's own artwork.

Run from the repository root:  python3 scripts/build-store-assets.py

Outputs (sizes required by Partner Center, see README "Store submission"):
  store/logo-300.png                 extension logo, 1:1, >=128px (300 recommended)
  store/tile-small-440x280.png       small promotional tile, exactly 440x280
  store/tile-large-1400x560.png      large promotional tile, exactly 1400x560
  store/screenshot-{1..4}-{en,zh}-1280x800.png
                                     store screenshots, exactly 1280x800

The screenshots are the real recorder UI captured from a loaded extension and then framed on the
app's own gradient, so they stay in sync with whatever assets/screenshot-*.png contains.
"""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
STORE = ROOT / "store"

# Pulled from recorder.css: linear-gradient(115deg, #101617, #142523 62%, #0d1918)
GRADIENT = [(16, 22, 23), (20, 37, 35), (13, 25, 24)]
INK = (237, 243, 238)
MUTED = (156, 175, 170)
ACCENT = (41, 165, 109)

FONT_CANDIDATES = {
    "bold": [
        "/System/Library/Fonts/Supplemental/Arial Bold.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ],
    "regular": [
        "/System/Library/Fonts/Supplemental/Arial.ttf",
        "/System/Library/Fonts/HelveticaNeue.ttc",
        "/System/Library/Fonts/Helvetica.ttc",
    ],
}


def font(kind, size):
    for path in FONT_CANDIDATES[kind]:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except OSError:
                continue
    return ImageFont.load_default()


def gradient_canvas(size):
    """Approximate the recorder's 115deg three-stop gradient."""
    width, height = size
    canvas = Image.new("RGB", (width, height), GRADIENT[0])
    pixels = canvas.load()
    # 115deg in CSS points down-and-to-the-left; project each pixel onto that axis.
    import math

    radians = math.radians(115)
    axis_x, axis_y = math.sin(radians), -math.cos(radians)
    projections = [
        (0 * axis_x + 0 * axis_y),
        (width * axis_x + 0 * axis_y),
        (0 * axis_x + height * axis_y),
        (width * axis_x + height * axis_y),
    ]
    low, high = min(projections), max(projections)
    span = (high - low) or 1
    for y in range(height):
        for x in range(width):
            t = ((x * axis_x + y * axis_y) - low) / span
            # Three stops at 0%, 62%, 100%.
            if t < 0.62:
                local = t / 0.62
                start, end = GRADIENT[0], GRADIENT[1]
            else:
                local = (t - 0.62) / 0.38
                start, end = GRADIENT[1], GRADIENT[2]
            pixels[x, y] = tuple(
                round(start[channel] + (end[channel] - start[channel]) * local) for channel in range(3)
            )
    return canvas


def rounded(image, radius):
    mask = Image.new("L", image.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle([0, 0, image.size[0] - 1, image.size[1] - 1], radius=radius, fill=255)
    return mask


def centered_text(draw, box, text, text_font, fill, y):
    left, top, right, _ = box
    width = draw.textbbox((0, 0), text, font=text_font)[2]
    draw.text((left + (right - left - width) / 2, y), text, font=text_font, fill=fill)
    return top


def build_logo():
    logo = Image.open(ASSETS / "logo.png").convert("RGBA")
    store_logo = logo.resize((300, 300), Image.LANCZOS)
    store_logo.save(STORE / "logo-300.png", optimize=True)
    return store_logo


def build_tile(size, logo, name_size, tagline_size, pad_ratio):
    canvas = gradient_canvas(size).convert("RGBA")
    draw = ImageDraw.Draw(canvas)
    width, height = size

    mark = int(height * pad_ratio)
    mark_image = logo.resize((mark, mark), Image.LANCZOS)
    name_font = font("bold", name_size)
    tagline_font = font("regular", tagline_size)
    tagline = "Local · Private · Edge   |   No account, no upload, no tracking"

    name_height = draw.textbbox((0, 0), "WeScreen", font=name_font)[3]
    tagline_height = draw.textbbox((0, 0), tagline, font=tagline_font)[3]
    gap_after_mark = int(height * 0.09)
    gap_after_name = int(height * 0.035)
    block = mark + gap_after_mark + name_height + gap_after_name + tagline_height
    y = (height - block) / 2

    canvas.paste(mark_image, (int((width - mark) / 2), int(y)), mark_image)
    y += mark + gap_after_mark
    centered_text(draw, (0, 0, width, height), "WeScreen", name_font, INK, y)
    y += name_height + gap_after_name
    centered_text(draw, (0, 0, width, height), tagline, tagline_font, MUTED, y)

    target = STORE / ("tile-small-440x280.png" if width == 440 else "tile-large-1400x560.png")
    canvas.convert("RGB").save(target, optimize=True)
    return target


def build_screenshot(source, target):
    canvas = gradient_canvas((1280, 800)).convert("RGBA")
    ui = Image.open(source).convert("RGBA")
    # Leave an even margin so the store's own chrome never overlaps the UI.
    max_width, max_height = 1080, 660
    scale = min(max_width / ui.width, max_height / ui.height)
    ui = ui.resize((round(ui.width * scale), round(ui.height * scale)), Image.LANCZOS)

    shadow = Image.new("RGBA", canvas.size, (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    x = (canvas.width - ui.width) // 2
    y = (canvas.height - ui.height) // 2
    shadow_draw.rounded_rectangle(
        [x - 4, y + 10, x + ui.width + 4, y + ui.height + 18], radius=18, fill=(0, 0, 0, 110)
    )
    shadow = shadow.filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(14))
    canvas = Image.alpha_composite(canvas, shadow)
    canvas.paste(ui, (x, y), rounded(ui, 14))
    canvas.convert("RGB").save(target, optimize=True)
    return target


def main():
    STORE.mkdir(exist_ok=True)
    logo = build_logo()
    print("store/logo-300.png                     300x300   (required, 1:1)")

    build_tile((440, 280), logo, name_size=44, tagline_size=13, pad_ratio=0.40)
    print("store/tile-small-440x280.png           440x280   (optional, exact size)")
    build_tile((1400, 560), logo, name_size=104, tagline_size=28, pad_ratio=0.30)
    print("store/tile-large-1400x560.png          1400x560  (optional, exact size)")

    plan = [
        ("1-setup-en", ASSETS / "screenshot-setup-en.png"),
        ("2-recording-en", ASSETS / "screenshot-recording-en.png"),
        ("3-result-en", ASSETS / "screenshot-result-en.png"),
        ("4-setup-zh", ASSETS / "screenshot-setup-zh.png"),
        ("5-recording-zh", ASSETS / "screenshot-recording-zh.png"),
        ("6-result-zh", ASSETS / "screenshot-result-zh.png"),
    ]
    for name, source in plan:
        if not source.exists():
            print(f"  SKIP {name}: missing {source.relative_to(ROOT)}")
            continue
        target = STORE / f"screenshot-{name}-1280x800.png"
        build_screenshot(source, target)
        print(f"store/{target.name:38s}1280x800  (max 6, exact size)")


if __name__ == "__main__":
    main()
