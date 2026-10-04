"""Start/update the user's helper without interrupting active processing jobs."""
import json
import os
from pathlib import Path
import subprocess
import urllib.request
import sys
from pairing import parse_pair_url, trusted_origins, grant_pairing
root=Path(__file__).resolve().parent
if len(sys.argv) > 1 and sys.argv[1] != 'wescreen-helper://start':
    origin, nonce = parse_pair_url(sys.argv[1])
    pair_file=Path(os.environ.get('WESCREEN_WORK_DIR',str(root/'.runtime/jobs')))/'extension-origin.txt'
    if origin not in trusted_origins(pair_file):
        prompt='允许这个 WeScreen 扩展连接本机处理程序？\n扩展 ID：'+origin.split('://')[1]+'\n已有录像、模型和任务会保留。'
        approval=subprocess.run(['osascript','-e','display dialog '+json.dumps(prompt,ensure_ascii=False)+' buttons {"取消", "允许连接"} default button "允许连接" cancel button "取消" with title "WeScreen 本机连接"'],capture_output=True)
        if approval.returncode: raise SystemExit(0)
    grant_pairing(pair_file, origin, nonce)
domain=f'gui/{os.getuid()}'
agent=Path.home()/'Library/LaunchAgents/com.wescreen.helper.plist'
try:
    token=(root/'.runtime/token.txt').read_text().strip()
    def get(path):
        return json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8765'+path,headers={'X-WeScreen-Token':token}),timeout=3))
    health=get('/health')
    if health.get('merge') and health.get('version')=='1.18.0': raise SystemExit(0)
    if any(j['state'] in ('queued','processing') for j in get('/jobs')['jobs']):
        raise SystemExit('An active processing job is running. Finish it before updating the helper.')
except (OSError,ValueError):
    pass
exists=subprocess.run(['launchctl','print',domain+'/com.wescreen.helper'],capture_output=True).returncode==0
if not exists: subprocess.run(['launchctl','bootstrap',domain,str(agent)],check=True)
else: subprocess.run(['launchctl','kickstart','-k',domain+'/com.wescreen.helper'],check=True)
