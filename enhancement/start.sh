#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
for full_ffmpeg in /opt/homebrew/opt/ffmpeg-full/bin /usr/local/opt/ffmpeg-full/bin; do
  if [ -x "$full_ffmpeg/ffmpeg" ]; then export PATH="$full_ffmpeg:$PATH"; break; fi
done
if ! command -v ffmpeg >/dev/null || ! command -v ffprobe >/dev/null; then
  if command -v brew >/dev/null; then
    echo 'Installing FFmpeg with Homebrew…'
    brew install ffmpeg
  else
    echo 'FFmpeg/ffprobe is missing. Install FFmpeg, then open start.command again.' >&2
    exit 1
  fi
fi
if [ ! -x .venv/bin/python ]; then
  engine_python=""
  for candidate in python3.13 python3.12 python3.11 python3.10 python3; do
    if command -v "$candidate" >/dev/null && "$candidate" -c 'import sys; raise SystemExit(not ((3,10) <= sys.version_info[:2] < (3,14)))'; then
      engine_python="$candidate"
      break
    fi
  done
  if [ -z "$engine_python" ]; then
    if command -v brew >/dev/null; then
      brew install python@3.12
      engine_python="$(brew --prefix python@3.12)/bin/python3.12"
    else
      echo "Python 3.10–3.13 is required. Install Python, then open start.command again." >&2
      exit 1
    fi
  fi
  "$engine_python" -m venv .venv
fi
if ! .venv/bin/python -c "import cv2, numpy; assert hasattr(cv2, 'dnn_superres')" 2>/dev/null; then
  .venv/bin/python -m pip install -r requirements.txt
fi
exec .venv/bin/python server.py
