#!/usr/bin/env python3
"""Generate a deterministic synthetic screen-content corpus as PNG sequences.

Synthetic clips are NOT a substitute for real recordings. They exist so the encoder
comparison is reproducible anywhere. Drop your own clips in with --import-video.

    python3 bench/make_corpus.py                      # 1280x720, 30 fps, 5 s
    python3 bench/make_corpus.py --size 1920x1080 --seconds 8
    python3 bench/make_corpus.py --import-video my-lecture.mp4 --name lecture
"""
import argparse
import json
import random
import re
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
FONT_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
    '/System/Library/Fonts/Menlo.ttc',
    'C:/Windows/Fonts/consola.ttf',
]
SANS_CANDIDATES = [
    '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    '/System/Library/Fonts/Helvetica.ttc',
    'C:/Windows/Fonts/segoeui.ttf',
]
KEYWORDS = re.compile(r'\b(const|let|var|function|return|if|else|for|of|await|async|new|try|catch|throw|class|import|from)\b')
STRING = re.compile(r"('[^']*'|\"[^\"]*\"|`[^`]*`)")
COMMENT = re.compile(r'//.*$')


def load_font(candidates, size):
    for path in candidates:
        if Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size=size)


def source_lines():
    lines = []
    for name in ('recorder.js', 'storage.js', 'background.js', 'library.js'):
        path = ROOT / name
        if path.exists():
            for raw in path.read_text(errors='ignore').splitlines():
                raw = raw.rstrip()
                # Monospace fonts lack CJK glyphs and would render rows of tofu boxes.
                if raw and raw.isascii():
                    # Very long lines are a minified wall of text; wrap them like an editor would.
                    while len(raw) > 110:
                        lines.append(raw[:110])
                        raw = '  ' + raw[110:]
                    lines.append(raw)
    return lines or ['// no source files found'] * 200


def words():
    text = ''
    for name in ('README.md', 'CHANGELOG.md'):
        path = ROOT / name
        if path.exists():
            text += path.read_text(errors='ignore')
    found = re.findall(r"[A-Za-z]{3,}", text)
    return found or ['screen', 'record', 'quality', 'size']


def paragraph(rng, pool, count):
    return ' '.join(rng.choice(pool) for _ in range(count)).capitalize() + '.'


def wrap(draw, text, font, width):
    out, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if draw.textlength(trial, font=font) <= width:
            line = trial
        else:
            out.append(line)
            line = word
    if line:
        out.append(line)
    return out


def texture(rng, w, h, seed, motion=0.0):
    """Smooth gradient + grain, a cheap stand-in for photographic content."""
    y, x = np.mgrid[0:h, 0:w].astype(np.float32)
    phase = motion
    r = 128 + 100 * np.sin(x / 57 + phase) * np.cos(y / 43 - phase * .7)
    g = 128 + 100 * np.sin((x + y) / 71 + phase * 1.3)
    b = 128 + 100 * np.cos(x / 83 - y / 61 + phase * .5)
    noise = np.random.default_rng(seed).normal(0, 9, (h, w, 1)).astype(np.float32)
    return np.clip(np.stack([r, g, b], axis=-1) + noise, 0, 255).astype(np.uint8)


# ---- clips -----------------------------------------------------------------
def clip_slides_static(w, h, n, fps):
    rng, pool = random.Random(1), words()
    title_font, body_font = load_font(SANS_CANDIDATES, h // 14), load_font(SANS_CANDIDATES, h // 26)
    slides = []
    for index in range(3):
        img = Image.new('RGB', (w, h), (250, 250, 252))
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, w, h // 9], fill=(30, 60, 120))
        draw.text((w // 20, h // 40), ' '.join(rng.choice(pool).capitalize() for _ in range(3)), font=title_font, fill=(255, 255, 255))
        top = h // 5
        for _ in range(5):
            draw.ellipse([w // 14, top + h // 60, w // 14 + h // 60, top + h // 30], fill=(30, 60, 120))
            for line in wrap(draw, paragraph(rng, pool, 9), body_font, w * 0.8):
                draw.text((w // 8, top), line, font=body_font, fill=(25, 25, 30))
                top += int(h / 15)
            top += h // 40
        slides.append(np.asarray(img))
    for i in range(n):
        yield slides[min(2, i * 3 // n)]


def clip_code_scroll(w, h, n, fps):
    font = load_font(FONT_CANDIDATES, h // 30)
    line_h = int(h / 24)
    lines = source_lines()
    total = (n * 3) // line_h + 60
    view = Image.new('RGB', (w, total * line_h), (30, 31, 34))
    draw = ImageDraw.Draw(view)
    for row in range(total):
        text = lines[row % len(lines)]
        y = row * line_h
        draw.text((8, y), f'{row + 1:>4}', font=font, fill=(110, 115, 125))
        x = 8 + int(draw.textlength('0000  ', font=font))
        comment = COMMENT.search(text)
        code = text[:comment.start()] if comment else text
        pos = 0
        for match in sorted(list(KEYWORDS.finditer(code)) + list(STRING.finditer(code)), key=lambda m: m.start()):
            if match.start() < pos:
                continue
            draw.text((x, y), code[pos:match.start()], font=font, fill=(205, 210, 220))
            x += int(draw.textlength(code[pos:match.start()], font=font))
            colour = (204, 120, 50) if match.re is KEYWORDS else (106, 171, 115)
            draw.text((x, y), match.group(0), font=font, fill=colour)
            x += int(draw.textlength(match.group(0), font=font))
            pos = match.end()
        draw.text((x, y), code[pos:], font=font, fill=(205, 210, 220))
        x += int(draw.textlength(code[pos:], font=font))
        if comment:
            draw.text((x, y), comment.group(0), font=font, fill=(128, 128, 128))
    arr = np.asarray(view)
    for i in range(n):
        offset = min(i * 3, arr.shape[0] - h)  # 3 px per frame: smooth reading-speed scroll
        yield arr[offset:offset + h]


def clip_web_scroll(w, h, n, fps):
    rng, pool = random.Random(7), words()
    h1, body = load_font(SANS_CANDIDATES, h // 16), load_font(SANS_CANDIDATES, h // 32)
    page_h = h * 6
    page = Image.new('RGB', (w, page_h), (255, 255, 255))
    draw = ImageDraw.Draw(page)
    top, seed = h // 20, 0
    margin = w // 6
    while top < page_h - h // 2:
        draw.text((margin, top), ' '.join(rng.choice(pool).capitalize() for _ in range(4)), font=h1, fill=(20, 20, 20))
        top += int(h / 10)
        for line in wrap(draw, paragraph(rng, pool, 70), body, w - 2 * margin):
            draw.text((margin, top), line, font=body, fill=(45, 45, 50))
            top += int(h / 22)
        top += h // 25
        if rng.random() < .7:
            ih = h // 3
            page.paste(Image.fromarray(texture(rng, w - 2 * margin, ih, seed)), (margin, top))
            seed += 1
            top += ih + h // 25
    arr = np.asarray(page)
    # Scroll in bursts: ease, then pause, like a person reading.
    offsets, offset = [], 0.0
    for i in range(n):
        phase = (i % 45) / 45
        if phase < .5:
            offset += 36 * np.sin(phase * np.pi * 2) ** 2
        offsets.append(int(min(offset, page_h - h)))
    for off in offsets:
        yield arr[off:off + h]


def clip_video_motion(w, h, n, fps):
    pad_x, pad_y = w // 10, h // 12
    vw, vh = w - 2 * pad_x, h - 2 * pad_y - h // 12
    base = np.zeros((h, w, 3), dtype=np.uint8) + 18
    chrome = Image.fromarray(base)
    draw = ImageDraw.Draw(chrome)
    draw.rectangle([pad_x, h - pad_y - h // 40, w - pad_x, h - pad_y], fill=(70, 70, 75))
    base = np.asarray(chrome).copy()
    for i in range(n):
        frame = base.copy()
        t = i / fps
        tex = texture(None, vw, vh, 100 + i, motion=t * 2.2)
        cx = int(vw * (.5 + .35 * np.sin(t * 1.7)))
        cy = int(vh * (.5 + .3 * np.cos(t * 1.1)))
        yy, xx = np.ogrid[0:vh, 0:vw]
        mask = (xx - cx) ** 2 + (yy - cy) ** 2 < (vh // 5) ** 2
        tex[mask] = (235, 235, 235)
        frame[pad_y:pad_y + vh, pad_x:pad_x + vw] = tex
        yield frame


def clip_ui_mixed(w, h, n, fps):
    rng, pool = random.Random(3), words()
    body = load_font(FONT_CANDIDATES, h // 30)
    text = ' '.join(paragraph(rng, pool, 40) for _ in range(6))
    vw, vh = w // 3, h // 3
    for i in range(n):
        img = Image.new('RGB', (w, h), (243, 244, 246))
        draw = ImageDraw.Draw(img)
        draw.rectangle([0, 0, w, h // 14], fill=(55, 65, 81))
        shown = text[:int(i * 3.2)]
        y = h // 8
        for line in wrap(draw, shown, body, w * 0.52):
            draw.text((w // 25, y), line, font=body, fill=(17, 24, 39))
            y += int(h / 22)
        frame = np.asarray(img).copy()
        tex = texture(None, vw, vh, 500 + i, motion=i / fps * 2.5)
        frame[h // 8:h // 8 + vh, w - vw - w // 25:w - w // 25] = tex
        mx, my = int(w * (.2 + .6 * i / n)), int(h * (.3 + .3 * np.sin(i / 20)))
        frame[my:my + 14, mx:mx + 10] = (0, 0, 0)  # cursor
        yield frame


CLIPS = {
    'slides_static': clip_slides_static,
    'code_scroll': clip_code_scroll,
    'web_scroll': clip_web_scroll,
    'video_motion': clip_video_motion,
    'ui_mixed': clip_ui_mixed,
}


def write_clip(root, name, frames, fps, w, h):
    out = root / name
    out.mkdir(parents=True, exist_ok=True)
    count = 0
    for index, frame in enumerate(frames):
        Image.fromarray(np.ascontiguousarray(frame)).save(out / f'{index:04d}.png', compress_level=1)
        count += 1
    (out / 'meta.json').write_text(json.dumps({'name': name, 'width': w, 'height': h, 'fps': fps, 'frames': count}, indent=2))
    return count


def import_video(root, path, name, w, h, fps, seconds):
    out = root / name
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', str(path), '-t', str(seconds), '-vf', f'scale={w}:{h}:flags=lanczos,fps={fps}',
                    '-start_number', '0', str(out / '%04d.png')], check=True)
    count = len(list(out.glob('*.png')))
    (out / 'meta.json').write_text(json.dumps({'name': name, 'width': w, 'height': h, 'fps': fps, 'frames': count}, indent=2))
    return count


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--out', default=str(ROOT / 'bench' / 'corpus'))
    parser.add_argument('--size', default='1280x720')
    parser.add_argument('--fps', type=int, default=30)
    parser.add_argument('--seconds', type=float, default=5)
    parser.add_argument('--only', nargs='*', help='subset of clip names')
    parser.add_argument('--import-video', help='convert your own recording into a corpus clip')
    parser.add_argument('--name', default='imported')
    args = parser.parse_args(argv)
    w, h = (int(v) for v in args.size.lower().split('x'))
    root = Path(args.out)
    root.mkdir(parents=True, exist_ok=True)
    if args.import_video:
        print(f'{args.name}: {import_video(root, args.import_video, args.name, w, h, args.fps, args.seconds)} frames')
        return 0
    n = int(args.fps * args.seconds)
    for name, factory in CLIPS.items():
        if args.only and name not in args.only:
            continue
        print(f'{name}: {write_clip(root, name, factory(w, h, n, args.fps), args.fps, w, h)} frames', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
