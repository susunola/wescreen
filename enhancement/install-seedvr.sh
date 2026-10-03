#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
runtime="$PWD/.runtime"
mkdir -p "$runtime"
if [ ! -f "$runtime/seedvr2/inference_cli.py" ]; then
  git clone https://github.com/numz/ComfyUI-SeedVR2_VideoUpscaler "$runtime/seedvr2"
  git -C "$runtime/seedvr2" checkout 4490bd1f482e026674543386bb2a4d176da245b9
fi
if [ "$(git -C "$runtime/seedvr2" rev-parse HEAD)" != '4490bd1f482e026674543386bb2a4d176da245b9' ]; then
  echo 'SeedVR2 source revision differs from the tested version; use a fresh .runtime/seedvr2 directory.' >&2
  exit 1
fi
if [ ! -x "$runtime/seedvr-venv/bin/python" ]; then
  .venv/bin/python -m venv "$runtime/seedvr-venv"
fi
"$runtime/seedvr-venv/bin/python" -m pip install -r requirements-seedvr.txt
mkdir -p "$runtime/seedvr-models"
for model in seedvr2_ema_3b_fp16.safetensors ema_vae_fp16.safetensors; do
  expected='2fd0e03a3dad24e07086750360727ca437de4ecd456f769856e960ae93e2b304'
  if [ "$model" = 'ema_vae_fp16.safetensors' ]; then expected='20678548f420d98d26f11442d3528f8b8c94e57ee046ef93dbb7633da8612ca1'; fi
  if [ -f "$runtime/seedvr-models/$model" ] && [ "$(shasum -a 256 "$runtime/seedvr-models/$model" | cut -d ' ' -f 1)" = "$expected" ]; then continue; fi
  curl --fail --location --retry 3 --continue-at - --output "$runtime/seedvr-models/$model" "https://huggingface.co/numz/SeedVR2_comfyUI/resolve/main/$model"
done
"$runtime/seedvr-venv/bin/python" verify-seedvr.py
echo 'SeedVR2 已安装。重新启动本机增强程序后可使用 AI 强力修复。'
