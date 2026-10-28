#!/usr/bin/env python3
"""Offline FFmpeg encoder sweep over the corpus: the quality/size ceiling a post-processing step can reach.

    python3 bench/ffmpeg_sweep.py                       # everything, appends to bench/results/ffmpeg.jsonl
    python3 bench/ffmpeg_sweep.py --clips code_scroll --encoders x264 svtav1

"realtime-proxy" rows approximate a hardware/real-time encoder fed the same bitrate the extension
requests (videoBitrate() in recorder.js). They are x264 veryfast zerolatency, NOT Chrome's MediaRecorder:
use browser_bench.mjs for the real thing.
"""
import argparse
import json
import subprocess
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from metrics import evaluate, load_meta  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
BENCH = ROOT / 'bench'
MOTION_CLIPS = {'video_motion'}

# name -> (extension, builder(param) -> ffmpeg args, params)
CRF_ENCODERS = {
    'x264': ('mp4', lambda p: ['-c:v', 'libx264', '-preset', 'medium', '-crf', str(p), '-g', '60', '-pix_fmt', 'yuv420p'], [20, 26, 32]),
    'x265': ('mp4', lambda p: ['-c:v', 'libx265', '-preset', 'medium', '-crf', str(p), '-g', '60', '-pix_fmt', 'yuv420p', '-tag:v', 'hvc1', '-x265-params', 'log-level=error'], [22, 28, 34]),
    'svtav1': ('mp4', lambda p: ['-c:v', 'libsvtav1', '-preset', '8', '-crf', str(p), '-g', '60', '-pix_fmt', 'yuv420p'], [30, 38, 46]),
    'vp9': ('webm', lambda p: ['-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', str(p), '-deadline', 'good', '-cpu-used', '4', '-row-mt', '1', '-g', '60', '-pix_fmt', 'yuv420p'], [28, 36, 44]),
}


def extension_bitrate(width, height, fps, scene, quality):
    """Port of videoBitrate() in recorder.js, so the proxy rows use what the extension actually asks for."""
    pixels = width * height / (1920 * 1080)
    f = max(1, fps) / 30
    if scene == 'detail':
        base = {'high': 24e6, 'compact': 3e6}.get(quality, 6e6)
    else:
        base = {'high': 14e6, 'compact': 2.5e6}.get(quality, 4e6)
    return min(180e6, round(base * max(.5, pixels ** .75) * f ** .585))


def encode(cmd_args, ref_dir, out_path, fps):
    cmd = ['ffmpeg', '-v', 'error', '-y', '-framerate', str(fps), '-i', str(Path(ref_dir) / '%04d.png'), *cmd_args, str(out_path)]
    started = time.time()
    subprocess.run(cmd, check=True)
    return time.time() - started


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--corpus', default=str(BENCH / 'corpus'))
    parser.add_argument('--out', default=str(BENCH / 'out'))
    parser.add_argument('--results', default=str(BENCH / 'results' / 'ffmpeg.jsonl'))
    parser.add_argument('--clips', nargs='*')
    parser.add_argument('--encoders', nargs='*', default=[*CRF_ENCODERS, 'realtime-proxy'])
    parser.add_argument('--sample', type=int, default=5)
    args = parser.parse_args(argv)

    corpus, out_dir, results = Path(args.corpus), Path(args.out), Path(args.results)
    out_dir.mkdir(parents=True, exist_ok=True)
    results.parent.mkdir(parents=True, exist_ok=True)
    clips = [p for p in sorted(corpus.iterdir()) if (p / 'meta.json').exists() and (not args.clips or p.name in args.clips)]
    with results.open('a') as sink:
        for clip in clips:
            meta = load_meta(clip)
            jobs = []
            for name in args.encoders:
                if name in CRF_ENCODERS:
                    ext, builder, params = CRF_ENCODERS[name]
                    jobs += [(name, f'crf{p}', ext, builder(p)) for p in params]
                elif name == 'realtime-proxy':
                    scene = 'motion' if meta['name'] in MOTION_CLIPS else 'detail'
                    for quality in ('compact', 'standard', 'high'):
                        bits = extension_bitrate(meta['width'], meta['height'], meta['fps'], scene, quality)
                        jobs.append((name, f'{quality}@{bits // 1000}k', 'mp4', ['-c:v', 'libx264', '-preset', 'veryfast', '-tune', 'zerolatency',
                                                                              '-b:v', str(bits), '-maxrate', str(bits), '-bufsize', str(bits // 2), '-g', '60', '-pix_fmt', 'yuv420p']))
            for name, param, ext, ffargs in jobs:
                target = out_dir / f'{meta["name"]}__{name}__{param.replace("@", "_")}.{ext}'
                seconds = encode(ffargs, clip, target, meta['fps'])
                row = evaluate(clip, target, args.sample)
                row.update({'encoder': name, 'param': param, 'encode_seconds': round(seconds, 1), 'source': 'ffmpeg'})
                sink.write(json.dumps(row) + '\n')
                sink.flush()
                print(f'{meta["name"]:14} {name:15} {param:16} {row["kbps"]:8.0f} kbps  ssim {row["ssim"]}  edge {row["edge_psnr"]}  ({seconds:.1f}s)', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())
