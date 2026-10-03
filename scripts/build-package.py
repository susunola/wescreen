#!/usr/bin/env python3
"""Build extension/helper packages from an explicit allowlist; never include local tokens or jobs."""
from pathlib import Path
import json
import zipfile
ROOT=Path(__file__).resolve().parents[1]
MANIFEST=json.loads((ROOT/'manifest.json').read_text())
VERSION=MANIFEST['version']
# Store validation applies to every resolved localized manifest description.
for locale_file in (ROOT/'_locales').glob('*/messages.json'):
    description=MANIFEST.get('description','')
    if description.startswith('__MSG_') and description.endswith('__'):
        key=description[6:-2]
        description=json.loads(locale_file.read_text())[key]['message']
    length=len(description.encode('utf-16-le'))//2
    if not 1 <= length <= 132:
        raise ValueError(f'{locale_file.parent.name}: manifest description has {length} characters; maximum is 132')
    print(f'{locale_file.parent.name}: description {length}/132 characters')
front=['capture-quality.js','quality.js','seeking.js','watermark.js','smart-tail.js','player-polish.js','playlist.js','pro-i18n.js','pro-capture.js','pro-player.js','realtime.js','playback.js','tab-source.js','manifest.json','capture-assist.js','controls.html','controls.js','version.js','background.js','popup.html','popup.js','popup.css','recorder.html','recorder.css','recorder.js','storage.js','library.js','workspace.js','telegram.js','compositor-worker.js','enhancer.js','editor.js','batch.js','pointer-tracker.js','helper-guide.html','assets/logo.png','assets/telegram-logo.png','assets/github-logo.png']
front += [str(p.relative_to(ROOT)) for name in ('icons','_locales') for p in (ROOT/name).rglob('*') if p.is_file()]
helper=['enhancement/tail.py','enhancement/pairing.py','enhancement/install-launcher.command','enhancement/launch-managed.py','enhancement/merge.py','enhancement/realtime.py','enhancement/reset-connection.command','enhancement/server.py','enhancement/start.sh','enhancement/start.command','enhancement/install-seedvr.sh','enhancement/install-seedvr.command','enhancement/requirements-seedvr.txt','enhancement/verify-seedvr.py','enhancement/requirements.txt','enhancement/README.md','enhancement/models/FSRCNN_x2.pb','enhancement/models/LICENSE-FSRCNN.txt']
for label,files in [('wescreen',front),('wescreen-helper',helper)]:
    target=ROOT/'store'/f'{label}-{VERSION}.zip'
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED) as archive:
        for name in sorted(files): archive.write(ROOT/name,name)
    with zipfile.ZipFile(target) as archive:
        assert not any('.runtime' in name or 'token' in name or '.venv' in name for name in archive.namelist())
        if label=='wescreen': assert json.loads(archive.read('manifest.json'))['version']==VERSION
    print(f'{target.name}: {len(files)} files, {target.stat().st_size:,} bytes')
