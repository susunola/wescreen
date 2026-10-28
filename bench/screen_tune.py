#!/usr/bin/env python3
"""Does an encoder's screen-content mode pay off? Re-encodes corpus clips with and without it.

    python3 bench/screen_tune.py base code_scroll slides_static   # screen-content switches, one CRF each
    python3 bench/screen_tune.py svtav1 code_scroll web_scroll    # SVT-AV1 + scm=1: preset x CRF grid

Writes bench/results/tune-<set>.jsonl. Findings are summarised in bench/TUNING.md.
"""
import json, subprocess, sys, time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import metrics  # noqa: E402

SETS = {}
# --- set 'base' ---
SETS["base"] = {
  'svtav1 crf38 base':   ('mp4',  ['-c:v','libsvtav1','-preset','6','-crf','38']),
  'svtav1 crf38 scm=1':  ('mp4',  ['-c:v','libsvtav1','-preset','6','-crf','38','-svtav1-params','scm=1']),
  'vp9 crf36 base':      ('webm', ['-c:v','libvpx-vp9','-b:v','0','-crf','36','-row-mt','1','-cpu-used','2']),
  'vp9 crf36 screen':    ('webm', ['-c:v','libvpx-vp9','-b:v','0','-crf','36','-row-mt','1','-cpu-used','2','-tune-content','1']),
  'x265 crf28 base':     ('mp4',  ['-c:v','libx265','-preset','medium','-crf','28','-x265-params','log-level=error']),
  'x265 crf28 scc':      ('mp4',  ['-c:v','libx265','-preset','medium','-crf','28','-x265-params','log-level=error:limit-sao=1:rskip=2:tskip=1']),
}

# --- set 'svtav1' ---
SETS["svtav1"] = {}
for preset in (6,8,10):
  for crf in (42,50):
    SETS["svtav1"][f'svtav1 p{preset} crf{crf} scm1']=('mp4',['-c:v','libsvtav1','-preset',str(preset),'-crf',str(crf),'-svtav1-params','scm=1'])

def main():
    which = sys.argv[1] if len(sys.argv) > 1 and sys.argv[1] in SETS else 'base'
    clips = [c for c in sys.argv[1:] if c not in SETS] or ['code_scroll', 'slides_static', 'ui_mixed', 'web_scroll']
    out = HERE / 'out' / 'tune'; out.mkdir(parents=True, exist_ok=True)
    rows = []
    for clip in clips:
        ref = HERE / 'corpus' / clip
        meta = json.loads((ref / 'meta.json').read_text())
        for name, (ext, args) in SETS[which].items():
            target = out / f'{clip}__{name.replace(" ", "_").replace("=", "")}.{ext}'
            started = time.time()
            run = subprocess.run(['ffmpeg', '-v', 'error', '-y', '-framerate', str(meta['fps']), '-i', str(ref / '%04d.png'), '-pix_fmt', 'yuv420p', *args, str(target)], capture_output=True, text=True)
            if run.returncode:
                print(clip, name, 'FAILED', run.stderr.strip()[-120:]); continue
            row = metrics.evaluate(ref, target, align=False)
            row.update(config=name, encode_seconds=round(time.time() - started, 1)); rows.append(row)
            print(f"{clip:14s} {name:22s} {row['kbps']:8.0f} kbps  edge {row['edge_psnr']:5.1f}  ssim {row['ssim']:.4f}  {row['encode_seconds']}s", flush=True)
    (HERE / 'results' / f'tune-{which}.jsonl').write_text(''.join(json.dumps(r) + '\n' for r in rows))


if __name__ == '__main__':
    main()
