#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
pair_dir="${WESCREEN_WORK_DIR:-.runtime/jobs}"
rm -f -- "$pair_dir/extension-origin.txt"
echo '配对已重置。请回到 WeScreen 点击自动连接。录像、模型和处理结果均保留。'
echo 'Pairing reset. Return to WeScreen and click Auto connect. Videos, models and results are preserved.'
