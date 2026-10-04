#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
face_runtime="$PWD/.runtime"
mkdir -p "$face_runtime"
echo 'CodeFormer 使用 S-Lab 非商业许可证；商用需另行取得授权。'
if [ ! -d "$face_runtime/codeformer/.git" ]; then
  git clone https://github.com/sczhou/CodeFormer "$face_runtime/codeformer"
  git -C "$face_runtime/codeformer" checkout b33cc7d639d6545bfcccc7e0bc6ae51f24e79c2b
fi
if [ "$(git -C "$face_runtime/codeformer" rev-parse HEAD)" != 'b33cc7d639d6545bfcccc7e0bc6ae51f24e79c2b' ]; then
  echo 'CodeFormer revision differs from the tested revision; use a fresh .runtime/codeformer directory.' >&2; exit 1
fi
if [ ! -x "$face_runtime/face-venv/bin/python" ]; then .venv/bin/python -m venv "$face_runtime/face-venv"; fi
"$face_runtime/face-venv/bin/python" -c 'import sys; assert (3, 11) <= sys.version_info[:2] <= (3, 12), "Face restoration requires Python 3.11 or 3.12; use Python 3.12 for the basic helper environment."'
"$face_runtime/face-venv/bin/python" -m pip install -r requirements-face.txt
# Only inference modules are needed. Avoid loading obsolete training imports.
"$face_runtime/face-venv/bin/python" - <<'PY'
from pathlib import Path
root=Path('.runtime/codeformer/basicsr')
(root/'__init__.py').write_text('# Inference-only CodeFormer runtime.\n')
(root/'archs/__init__.py').write_text('# Architectures are imported explicitly.\n')
PY
mkdir -p "$face_runtime/codeformer/weights/CodeFormer" "$face_runtime/codeformer/weights/facelib"
for face_weight in codeformer.pth detection_Resnet50_Final.pth parsing_parsenet.pth; do
  face_dir='facelib'; if [ "$face_weight" = 'codeformer.pth' ]; then face_dir='CodeFormer'; fi
  if [ ! -f "$face_runtime/codeformer/weights/$face_dir/$face_weight" ]; then
    curl --fail --location --retry 3 --output "$face_runtime/codeformer/weights/$face_dir/$face_weight.part" "https://github.com/sczhou/CodeFormer/releases/download/v0.1.0/$face_weight"
    mv "$face_runtime/codeformer/weights/$face_dir/$face_weight.part" "$face_runtime/codeformer/weights/$face_dir/$face_weight"
  fi
done
"$face_runtime/face-venv/bin/python" verify-face.py
echo '脸部修复模型已安装，重新启动本机增强程序即可使用。'
