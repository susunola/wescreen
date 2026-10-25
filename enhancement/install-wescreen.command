#!/bin/bash
# One entry point for helper setup/update; optional neural model setup is explicit.
set -euo pipefail
bundle_dir="$(cd "$(dirname "$0")" && pwd)"
target_dir="${WESCREEN_INSTALL_DIR:-$HOME/Library/Application Support/WeScreen/helper}"
if [ -z "${WESCREEN_INSTALL_DIR:-}" ] && [ -f "$HOME/Library/LaunchAgents/com.wescreen.helper.plist" ]; then
  target_dir="$(python3 - <<'PY'
import pathlib,plistlib
p=pathlib.Path.home()/'Library/LaunchAgents/com.wescreen.helper.plist'
a=plistlib.loads(p.read_bytes()).get('ProgramArguments',[])
print(str(pathlib.Path(a[1]).parent) if len(a)>1 and a[1].endswith('/server.py') else str(pathlib.Path.home()/'Library/Application Support/WeScreen/helper'))
PY
)"
fi
if [ "$(uname -s)" != "Darwin" ]; then echo 'This managed installer currently supports macOS only.' >&2; exit 1; fi
if [ "${1:-}" = "--rollback" ]; then
  python3 "$bundle_dir/update-manager.py" --target "$target_dir" --rollback
else
  python3 "$bundle_dir/update-manager.py" --source "$bundle_dir" --target "$target_dir"
fi
cd "$target_dir"
bash start.sh --setup-only
# Reuse a validated model runtime; only install optional weights when requested.
if [ "${1:-}" = "--with-smart" ]; then bash install-smart.sh; fi
bash install-launcher.command
.venv/bin/python launch-managed.py
if [ "${1:-}" = "--rollback" ]; then launchctl kickstart -k "gui/$(id -u)/com.wescreen.helper"; fi
.venv/bin/python - <<'PY'
import json,time,urllib.request
from pathlib import Path
try:
 from installation import build_id,PROTOCOL_VERSION
except ImportError:
 build_id=lambda root:None;PROTOCOL_VERSION=None
root=Path.cwd();token=(root/'.runtime/token.txt').read_text().strip();last=None
for attempt in range(40):
 try:
  with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8765/health',headers={'X-WeScreen-Token':token}),timeout=2) as response:health=json.load(response)
  if (PROTOCOL_VERSION is None and health.get('ready')) or (health.get('buildId')==build_id(root) and health.get('protocolVersion')==PROTOCOL_VERSION):
   print(json.dumps({'installed':True,'version':health['version'],'protocolVersion':health.get('protocolVersion'),'smartModelReady':health.get('smartNeural',False)}));break
 except Exception as error:last=type(error).__name__
 time.sleep(.5)
else:raise SystemExit('Helper health check failed; use install-wescreen.command --rollback to restore previous code. '+str(last))
PY
