"""Transactional, offline helper code update. Runtime, tokens, models and jobs stay in place."""
import argparse,hashlib,json,os,re,shutil,sys,tempfile,time,urllib.request
from pathlib import Path
from installation import build_id

EXTENSIONS={'.py','.sh','.command','.txt','.pb'}

def code_files(root):
    root=Path(root);files=[]
    for p in list(root.iterdir())+list((root/'models').rglob('*')):
        relative=p.relative_to(root)
        if any(part.startswith('.') or part=='__pycache__' for part in relative.parts):continue
        if p.is_symlink():raise ValueError('Helper code cannot contain symbolic links')
        if p.is_file() and p.suffix in EXTENSIONS:
            if len(relative.parts)>1 and relative.parts[0]!='models':continue
            files.append(relative)
    return sorted(files)

def validate(root):
    root=Path(root)
    for required in ['server.py','installation.py','start.sh','requirements.txt','models/FSRCNN_x2.pb']:
        if not (root/required).is_file():raise ValueError('Incomplete helper package: '+required)
    for relative in code_files(root):
        if relative.suffix=='.py':compile((root/relative).read_bytes(),str(relative),'exec')
    expected=re.search(r"MODEL_HASH\s*=\s*'([a-f0-9]{64})'",(root/'server.py').read_text())
    if expected and hashlib.sha256((root/'models/FSRCNN_x2.pb').read_bytes()).hexdigest()!=expected[1]:raise ValueError('Bundled model checksum mismatch')
    return build_id(root)

def idle_guard(target):
    token=Path(target)/'.runtime/token.txt'
    if not token.exists():return
    def get(path):
        with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8765'+path,headers={'X-WeScreen-Token':token.read_text().strip()}),timeout=3) as response:return json.load(response)
    try:health=get('/health');jobs=get('/jobs')['jobs']
    except urllib.error.URLError as error:
        if isinstance(error,urllib.error.HTTPError):raise RuntimeError('Cannot authenticate running helper; update refused') from error
        # Only connection refusal means no listening helper. Timeouts are not proof of idleness.
        import errno
        if getattr(error.reason,'errno',None)==errno.ECONNREFUSED:return
        raise RuntimeError('Cannot establish helper state; update refused') from error
    if health.get('activeSmartSessions',1)>0 or any(j['state'] in ('queued','processing') for j in jobs):raise RuntimeError('Close playback and finish active tasks before updating')
    if health.get('managedUpdates'):
        request=urllib.request.Request('http://127.0.0.1:8765/maintenance',data=b'{}',method='POST',headers={'X-WeScreen-Token':token.read_text().strip()})
        with urllib.request.urlopen(request,timeout=3) as response:
            if not json.load(response).get('readyForUpdate'):raise RuntimeError('Helper did not enter update mode')

def release_maintenance(target):
    token=Path(target)/'.runtime/token.txt'
    if not token.exists():return
    try:
        request=urllib.request.Request('http://127.0.0.1:8765/maintenance',method='DELETE',headers={'X-WeScreen-Token':token.read_text().strip()})
        urllib.request.urlopen(request,timeout=3).close()
    except Exception:pass

def install(source,target):
    acquired=False
    def acquire():
        nonlocal acquired
        idle_guard(target);acquired=True
    try:
        result=_install(source,target,acquire)
        if result['state']=='unchanged':release_maintenance(target)
        return result
    except Exception:
        if acquired:release_maintenance(target)
        raise

def _install(source,target,acquire):
    source=Path(source).resolve();target=Path(target).resolve();identity=validate(source)
    acquire()
    if source==target:return {'state':'unchanged','buildId':identity}
    target.mkdir(parents=True,exist_ok=True)
    updates=target/'.runtime/updates';updates.mkdir(parents=True,exist_ok=True)
    folder=Path(tempfile.mkdtemp(prefix='update-',dir=updates));stage=folder/'stage';backup=folder/'backup';stage.mkdir();backup.mkdir();changes=[]
    for relative in code_files(source):
        p=stage/relative;p.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source/relative,p)
    validate(stage)
    receipt={'state':'prepared','buildId':identity,'changes':changes,'createdAt':time.time()}
    journal=folder/'receipt.json'
    try:
        for relative in code_files(stage):
            destination=target/relative;old=backup/relative;existed=destination.exists()
            if destination.is_symlink() or any(parent.is_symlink() for parent in destination.parents if parent!=target and parent.is_relative_to(target)):raise ValueError('Installed code cannot redirect writes through symlinks')
            if existed:old.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(destination,old)
            changes.append({'file':str(relative),'existed':existed})
            journal.write_text(json.dumps(receipt));destination.parent.mkdir(parents=True,exist_ok=True);os.replace(stage/relative,destination)
        validate(target);receipt['state']='installed';journal.write_text(json.dumps(receipt))
        (updates/'latest.json').write_text(json.dumps({'receipt':str(journal)}))
        return {'state':'installed','buildId':identity,'receipt':str(journal)}
    except Exception:
        receipt['state']='failed';journal.write_text(json.dumps(receipt));rollback(target,journal,guard=False)
        raise

def rollback(target,journal,guard=True):
    target=Path(target).resolve();journal=Path(journal).resolve();updates=target/'.runtime/updates'
    if not journal.is_relative_to(updates.resolve()):raise ValueError('Rollback receipt is outside update history')
    if guard:idle_guard(target)
    receipt=json.loads(journal.read_text());backup=journal.parent/'backup'
    for item in reversed(receipt['changes']):
        relative=Path(item['file'])
        if relative.is_absolute() or '..' in relative.parts or any(p.startswith('.') for p in relative.parts):raise ValueError('Unsafe rollback path')
        destination=target/relative
        if item['existed']:
            temporary=destination.with_name(destination.name+'.rollback');shutil.copy2(backup/relative,temporary);os.replace(temporary,destination)
        else:destination.unlink(missing_ok=True)
    receipt['state']='rolled-back';journal.write_text(json.dumps(receipt));return {'state':'rolled-back'}

if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--source',type=Path);parser.add_argument('--target',type=Path,required=True);parser.add_argument('--rollback',action='store_true');parser.add_argument('--check',action='store_true');args=parser.parse_args()
    if args.rollback:
        latest=json.loads((args.target/'.runtime/updates/latest.json').read_text());result=rollback(args.target,latest['receipt'])
    elif args.check:result={'state':'validated','buildId':validate(args.target)}
    elif args.source:result=install(args.source,args.target)
    else:parser.error('--source, --check or --rollback is required')
    print(json.dumps(result))
