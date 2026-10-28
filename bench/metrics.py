#!/usr/bin/env python3
"""Objective metrics for comparing an encoded recording with its reference frames.

    python3 bench/metrics.py --ref bench/corpus/code_scroll --encoded out/code.webm

Reported per file: size, bitrate, PSNR/SSIM on luma, and edge PSNR, which only looks at pixels
with strong gradients in the reference (text edges, UI borders). Edge PSNR is the number that
tracks how readable text stays; plain PSNR is dominated by flat areas.

No VMAF: the ffmpeg builds we can rely on usually lack libvmaf, so it is not computed here.
"""
import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np
from skimage.metrics import structural_similarity

EDGE_THRESHOLD = 40  # Sobel magnitude (0-255 scale) above which a reference pixel counts as an edge
MAX_OFFSET = 4       # frames of start-time misalignment we search over (MediaRecorder is wall-clock paced)
MATCH_WINDOW = 24    # extra frames decoded beyond the clip length so a stretched real-time recording is still covered


# Frame markers: browser benchmark frames carry their own index in the top-left corner as 18 black/white
# 16x16 blocks (2 sync bits "10", then 16 index bits, MSB first). Blocks that large survive any sane bitrate.
# That makes matching exact even when a real-time recorder drops, repeats or re-times frames, which is what
# MediaRecorder does. The marker rows are cropped from every comparison so they never count as content.
MARKER_BLOCK = 16
MARKER_SYNC = (1, 0)
MARKER_BITS = 16
MARKER_ROWS = MARKER_BLOCK


def marker_bits(index):
    return [*MARKER_SYNC, *[(index >> (MARKER_BITS - 1 - k)) & 1 for k in range(MARKER_BITS)]]


def stamp_marker(frame, index):
    """Write the marker for `index` into a grayscale frame (in place) and return it."""
    for k, bit in enumerate(marker_bits(index)):
        frame[:MARKER_BLOCK, k * MARKER_BLOCK:(k + 1) * MARKER_BLOCK] = 255 if bit else 0
    return frame


def read_marker(frame):
    """Frame index encoded in the marker, or None when the sync bits do not match (not a stamped frame)."""
    half = MARKER_BLOCK // 2
    levels = []
    for k in range(len(MARKER_SYNC) + MARKER_BITS):
        block = frame[half - 3:half + 3, k * MARKER_BLOCK + half - 3:k * MARKER_BLOCK + half + 3]
        levels.append(1 if float(block.mean()) > 127 else 0)
    if tuple(levels[:len(MARKER_SYNC)]) != MARKER_SYNC:
        return None
    value = 0
    for bit in levels[len(MARKER_SYNC):]:
        value = (value << 1) | bit
    return value


def load_meta(ref_dir):
    return json.loads((Path(ref_dir) / 'meta.json').read_text())


def read_reference(ref_dir, indices):
    return {i: cv2.imread(str(Path(ref_dir) / f'{i:04d}.png'), cv2.IMREAD_GRAYSCALE) for i in indices}


def decode_luma(path, width, height, fps, limit):
    """Decode to constant-frame-rate raw luma so variable-frame-rate output lines up index by index."""
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-vf', f'fps={fps},scale={width}:{height}:flags=bicubic,format=gray',
           '-frames:v', str(limit), '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    data = subprocess.run(cmd, capture_output=True, check=True).stdout
    size = width * height
    count = len(data) // size
    return np.frombuffer(data[:count * size], dtype=np.uint8).reshape(count, height, width)


def decode_luma_raw(path, width, height, limit):
    """Every frame the file actually contains, in order, with no frame-rate resampling."""
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path), '-fps_mode', 'passthrough', '-vf', f'scale={width}:{height}:flags=bicubic,format=gray',
           '-frames:v', str(limit), '-f', 'rawvideo', '-pix_fmt', 'gray', '-']
    data = subprocess.run(cmd, capture_output=True, check=True).stdout
    size = width * height
    count = len(data) // size
    return np.frombuffer(data[:count * size], dtype=np.uint8).reshape(count, height, width)


def probe(path):
    out = subprocess.run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
                          'stream=codec_name,width,height,nb_frames:format=duration', '-of', 'json', str(path)],
                         capture_output=True, text=True, check=True).stdout
    data = json.loads(out)
    stream = (data.get('streams') or [{}])[0]
    return {'codec': stream.get('codec_name'), 'width': stream.get('width'), 'height': stream.get('height')}


def psnr(a, b):
    mse = float(np.mean((a.astype(np.float32) - b.astype(np.float32)) ** 2))
    return 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def edge_mask(reference):
    gx = cv2.Sobel(reference, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(reference, cv2.CV_32F, 0, 1, ksize=3)
    return np.hypot(gx, gy) / 4.0 > EDGE_THRESHOLD  # ksize-3 Sobel has gain 4 on a unit step


def edge_psnr(reference, decoded):
    mask = edge_mask(reference)
    if not mask.any():
        return None
    diff = reference.astype(np.float32)[mask] - decoded.astype(np.float32)[mask]
    mse = float(np.mean(diff ** 2))
    return 99.0 if mse == 0 else 10 * math.log10(255 ** 2 / mse)


def best_offset(ref_frames, decoded, indices, max_offset=MAX_OFFSET):
    """Pick the integer frame shift with the lowest mean absolute error on a few probe frames."""
    probes = indices[len(indices) // 4: len(indices) // 4 + 3] or indices[:3]
    best, best_error = 0, None
    for offset in range(-max_offset, max_offset + 1):
        errors = []
        for i in probes:
            j = i + offset
            if 0 <= j < len(decoded):
                errors.append(float(np.mean(np.abs(ref_frames[i].astype(np.int16) - decoded[j].astype(np.int16)))))
        if errors and (best_error is None or np.mean(errors) < best_error):
            best, best_error = offset, float(np.mean(errors))
    return best


def match_frame(ref, decoded, center, window=None):
    """Index of the decoded frame closest to `ref`, searching everywhere (window=None) or within `window` of `center`.

    Real-time MediaRecorder output has irregular timestamps; resampled to constant fps, frame N is not
    reference frame N. Matching on content removes timing from the comparison so only pixel fidelity is
    scored (timing problems still show in frames_decoded). Every encoder gets the same treatment.
    """
    best, best_error = center, None
    lo, hi = (0, len(decoded)) if window is None else (max(0, center - window), min(len(decoded), center + window + 1))
    for j in range(lo, hi):
        error = float(np.mean(np.abs(ref.astype(np.int16) - decoded[j].astype(np.int16))))
        if best_error is None or error < best_error:
            best, best_error = j, error
    return best


def evaluate(ref_dir, encoded, sample=5, align=True):
    meta = load_meta(ref_dir)
    width, height, fps, frames = meta['width'], meta['height'], meta['fps'], meta['frames']
    decoded = decode_luma(encoded, width, height, fps, frames + MATCH_WINDOW + MAX_OFFSET + 2)
    indices = list(range(0, frames, sample))
    ref_frames = read_reference(ref_dir, indices)
    offset = best_offset(ref_frames, decoded, indices) if align else 0
    ps, ss, es, shifts = [], [], [], []
    for i in indices:
        j = i + offset
        if not 0 <= j < len(decoded):
            continue
        if align:
            j = match_frame(ref_frames[i], decoded, j)
            shifts.append(abs(j - i - offset))
        ps.append(psnr(ref_frames[i], decoded[j]))
        ss.append(structural_similarity(ref_frames[i], decoded[j], data_range=255))
        e = edge_psnr(ref_frames[i], decoded[j])
        if e is not None:
            es.append(e)
    size = Path(encoded).stat().st_size
    seconds = frames / fps
    row = {
        'clip': meta['name'], 'file': Path(encoded).name, 'bytes': size, 'seconds': round(seconds, 3),
        'kbps': round(size * 8 / seconds / 1000, 1), 'mb_per_min': round(size / seconds * 60 / 1e6, 3),
        'psnr': round(float(np.mean(ps)), 2) if ps else None,
        'ssim': round(float(np.mean(ss)), 4) if ss else None,
        'edge_psnr': round(float(np.mean(es)), 2) if es else None,
        'frames_decoded': int(len(decoded)), 'frames_expected': frames, 'offset': offset,
        'mean_shift': round(float(np.mean(shifts)), 2) if shifts else 0.0,
    }
    row.update(probe(encoded))
    return row


def evaluate_stamped(ref_dir, encoded, sample=5):
    """Score a recording whose frames carry index markers. Timing cannot bias the pixel metrics here.

    Quality is measured on sampled reference frames that the recording actually contains; how many it
    dropped is reported separately as coverage and max_gap (longest run of missing frames).
    """
    meta = load_meta(ref_dir)
    width, height, fps, frames = meta['width'], meta['height'], meta['fps'], meta['frames']
    decoded = decode_luma_raw(encoded, width, height, frames * 3)
    by_index = {}
    unreadable = 0
    for frame in decoded:
        index = read_marker(frame)
        if index is None or index >= frames:
            unreadable += 1
        else:
            by_index.setdefault(index, frame)
    present = sorted(by_index)
    gaps, previous, max_gap = 0, -1, 0
    for index in [*present, frames]:
        max_gap = max(max_gap, index - previous - 1)
        previous = index
    indices = [i for i in range(0, frames, sample) if i in by_index]
    ref_frames = read_reference(ref_dir, indices)
    ps, ss, es = [], [], []
    for i in indices:
        a, b = ref_frames[i][MARKER_ROWS:], by_index[i][MARKER_ROWS:]
        ps.append(psnr(a, b))
        ss.append(structural_similarity(a, b, data_range=255))
        e = edge_psnr(a, b)
        if e is not None:
            es.append(e)
    size = Path(encoded).stat().st_size
    seconds = frames / fps
    row = {
        'clip': meta['name'], 'file': Path(encoded).name, 'bytes': size, 'seconds': round(seconds, 3),
        'kbps': round(size * 8 / seconds / 1000, 1), 'mb_per_min': round(size / seconds * 60 / 1e6, 3),
        'psnr': round(float(np.mean(ps)), 2) if ps else None,
        'ssim': round(float(np.mean(ss)), 4) if ss else None,
        'edge_psnr': round(float(np.mean(es)), 2) if es else None,
        'frames_decoded': len(decoded), 'frames_expected': frames, 'markers': True,
        'coverage': round(len(present) / frames, 4), 'max_gap': max_gap, 'unreadable_frames': unreadable, 'mean_shift': 0.0,
    }
    row.update(probe(encoded))
    return row


def size_at_quality(points, metric, target):
    """Interpolate the byte size at which `metric` reaches `target`, in log-size.

    points: list of dicts with 'bytes' and the metric. Returns None when the target lies outside the
    measured range, which is the honest answer rather than an extrapolation.
    """
    pts = sorted((p[metric], p['bytes']) for p in points if p.get(metric) is not None)
    for (q0, b0), (q1, b1) in zip(pts, pts[1:]):
        if q0 <= target <= q1 and q1 != q0:
            t = (target - q0) / (q1 - q0)
            return math.exp(math.log(b0) + t * (math.log(b1) - math.log(b0)))
    return None


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--ref', required=True)
    parser.add_argument('--encoded', required=True)
    parser.add_argument('--sample', type=int, default=5, help='evaluate every Nth frame')
    parser.add_argument('--no-align', action='store_true')
    parser.add_argument('--markers', action='store_true', help='frames carry index markers (browser benchmark output)')
    args = parser.parse_args(argv)
    result = evaluate_stamped(args.ref, args.encoded, args.sample) if args.markers else evaluate(args.ref, args.encoded, args.sample, not args.no_align)
    print(json.dumps(result, indent=2))
    return 0


if __name__ == '__main__':
    sys.exit(main())
