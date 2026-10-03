#!/usr/bin/env bash
cd "$(dirname "$0")" || exit 1
bash install-seedvr.sh
read -r -p '按回车关闭窗口…'
