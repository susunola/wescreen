#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo 'Open start.command once to install dependencies, then run this installer again.' >&2
  exit 1
fi
.venv/bin/python - <<'PY'
import pathlib,plistlib,subprocess,shlex,json,os,sys,shutil,re
root=pathlib.Path.cwd();runtime=root/'.runtime';runtime.mkdir(exist_ok=True)
support=pathlib.Path.home()/'Library/Application Support/WeScreen/launcher';support.mkdir(parents=True,exist_ok=True);support.chmod(0o700)
pair=support/'pairing';pair.mkdir(exist_ok=True);pair.chmod(0o700)
for name in ['extension-origin.txt','trusted-origins.json']:
    old=runtime/'jobs'/name
    if old.exists() and not (pair/name).exists(): shutil.copy2(old,pair/name)
for name in ['launch-managed.py','pairing.py']: shutil.copy2(root/name,support/name)
token=support/'token.txt'
if (runtime/'token.txt').exists(): shutil.copy2(runtime/'token.txt',token);token.chmod(0o600)
config=support/'launcher-config.json';config.write_text(json.dumps({'pairDirectory':str(pair),'tokenFile':str(token),'version':re.search(r"'version'\s*:\s*'([^']+)'",(root/'server.py').read_text()).group(1)}));config.chmod(0o600)
launcher=support/'launch-managed.sh'
launcher.write_text('#!/bin/bash\nset -euo pipefail\n'+shlex.quote(sys._base_executable)+' '+shlex.quote(str(support/'launch-managed.py'))+' "$@"\n')
launcher.chmod(0o700)
agent=pathlib.Path.home()/'Library/LaunchAgents/com.wescreen.helper.plist';agent.parent.mkdir(parents=True,exist_ok=True)
agent.write_bytes(plistlib.dumps({'Label':'com.wescreen.helper','ProgramArguments':[str(root/'.venv/bin/python'),str(root/'server.py')],'WorkingDirectory':str(root),'RunAtLoad':True,'KeepAlive':True,'EnvironmentVariables':{'PATH':'/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin','WESCREEN_PAIR_DIR':str(pair)},'StandardOutPath':str(runtime/'helper.log'),'StandardErrorPath':str(runtime/'helper-error.log')}));agent.chmod(0o600)
apps=pathlib.Path.home()/'Applications';apps.mkdir(exist_ok=True);app=apps/'WeScreen Helper Launcher.app'
source=runtime/'launcher.applescript';command=shlex.quote(str(launcher))
source.write_text('on run\n  do shell script '+json.dumps(command)+'\nend run\non open location theURL\n  do shell script '+json.dumps(command)+' & " " & quoted form of theURL\nend open location\n')
subprocess.run(['osacompile','-o',str(app),str(source)],check=True)
info=app/'Contents/Info.plist';data=plistlib.loads(info.read_bytes());data.update(CFBundleIdentifier='com.wescreen.helper.launcher',CFBundleURLTypes=[{'CFBundleURLName':'WeScreen Helper','CFBundleURLSchemes':['wescreen-helper']}],LSUIElement=True);info.write_bytes(plistlib.dumps(data))
register='/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister';subprocess.run([register,'-f',str(app)],check=True)
print('Installed local launcher. The browser can now open wescreen-helper://start; recordings and models are preserved.')
PY
