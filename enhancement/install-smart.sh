#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .runtime/smart-venv/bin/python ]; then
  if [ ! -x .venv/bin/python ]; then echo 'Start the helper once before installing Smart repair.' >&2; exit 1; fi
  .venv/bin/python -m venv .runtime/smart-venv
fi
.runtime/smart-venv/bin/python -m pip install -r requirements-smart.txt
mkdir -p .runtime/smart-models
for model in realesr-general-x4v3 realesr-general-wdn-x4v3; do
  if [ ! -f ".runtime/smart-models/$model.pth" ]; then
    curl -fL --retry 2 -o ".runtime/smart-models/$model.pth.part" "https://github.com/xinntao/Real-ESRGAN/releases/download/v0.2.5.0/$model.pth"
    mv ".runtime/smart-models/$model.pth.part" ".runtime/smart-models/$model.pth"
  fi
done
.runtime/smart-venv/bin/python verify-smart.py
