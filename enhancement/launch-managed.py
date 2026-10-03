"""Start/update the user's helper without interrupting active processing jobs."""
import json
import os
from pathlib import Path
import subprocess
import urllib.request
root=Path(__file__).resolve().parent
domain=f'gui/{os.getuid()}'
agent=Path.home()/'Library/LaunchAgents/com.wescreen.helper.plist'
try:
    token=(root/'.runtime/token.txt').read_text().strip()
    def get(path):
        return json.load(urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8765'+path,headers={'X-WeScreen-Token':token}),timeout=3))
    health=get('/health')
    if health.get('merge') and health.get('version')=='1.16.0': raise SystemExit(0)
    if any(j['state'] in ('queued','processing') for j in get('/jobs')['jobs']):
        raise SystemExit('An active processing job is running. Finish it before updating the helper.')
except (OSError,ValueError):
    pass
exists=subprocess.run(['launchctl','print',domain+'/com.wescreen.helper'],capture_output=True).returncode==0
if not exists: subprocess.run(['launchctl','bootstrap',domain,str(agent)],check=True)
else: subprocess.run(['launchctl','kickstart','-k',domain+'/com.wescreen.helper'],check=True)
