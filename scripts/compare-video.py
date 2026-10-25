"""Local same-input comparison pipeline. External engines are imported, never simulated."""
import argparse,hashlib,json,math,os,re,secrets,shutil,subprocess,sys,time,uuid
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
sys.path.insert(0,str(ROOT/'enhancement'))
from installation import build_id
from smart_model import smart_ready,ROOT as HELPER

def run(command,**kwargs):return subprocess.run(command,check=True,capture_output=True,**kwargs)
def probe(file):
 data=json.loads(run(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(file)]).stdout);video=next(s for s in data['streams'] if s['codec_type']=='video');n,d=map(int,video['avg_frame_rate'].split('/'));return {'width':video['width'],'height':video['height'],'fps':n/d,'duration':float(data['format']['duration']),'bytes':Path(file).stat().st_size}
def sha(file):
 with Path(file).open('rb') as stream:return hashlib.file_digest(stream,'sha256').hexdigest()
def save(folder,case):(folder/'case.json').write_text(json.dumps(case,indent=2))
def load(folder):
 case=json.loads((folder/'case.json').read_text())
 if sha(folder/'input.mp4')!=case['inputSHA256']:raise ValueError('Comparison input changed')
 if case.get('referenceSHA256') and sha(folder/'reference.mp4')!=case['referenceSHA256']:raise ValueError('Comparison reference changed')
 return case
def validate(spec,output):
 info=probe(output)
 for field in ['width','height']:
  if info[field]!=spec[field]:raise ValueError(field+' differs from comparison spec')
 if abs(info['fps']-spec['fps'])>=.02:raise ValueError('Frame rate differs')
 if abs(info['duration']-spec['duration'])>max(.15,2/spec['fps']):raise ValueError('Duration differs; check matching start/end')
 return info

def prepare(args):
 folder=args.case.resolve();folder.mkdir(parents=True,exist_ok=True)
 if (folder/'case.json').exists():raise ValueError('Case already exists; use a new case directory')
 source=probe(args.source);fps=min(30,max(1,round(source['fps'])));scale=min(1,1920/source['width'],1080/source['height']);width=max(2,int(source['width']*scale)//2*2);height=max(2,int(source['height']*scale)//2*2);clip=folder/'input.mp4'
 if args.start<0 or not 1<=args.seconds<=30:raise ValueError('Use nonnegative start and a 1..30 second clip')
 run(['ffmpeg','-nostdin','-v','error','-ss',str(args.start),'-i',str(args.source),'-t',str(args.seconds),'-an','-vf',f'scale={width}:{height},fps={fps}','-c:v','libx264','-crf','12','-preset','fast','-pix_fmt','yuv420p','-movflags','+faststart',str(clip)])
 case={'version':1,'inputSHA256':sha(clip),'offset':args.start,'spec':probe(clip),'outputs':{},'note':'All engines must use input.mp4 with the same dimensions, fps and complete duration. No blind winner is inferred from file size or speed.'}
 if args.reference:
  validate(case['spec'],args.reference);shutil.copy2(args.reference,folder/'reference.mp4');case['referenceSHA256']=sha(folder/'reference.mp4')
 save(folder,case);return {'case':str(folder),'inputSHA256':case['inputSHA256'],'spec':case['spec']}

def render(args):
 folder=args.case.resolve();case=load(folder);assert sha(folder/'input.mp4')==case['inputSHA256'],'Input changed'
 target=folder/'outputs'/args.engine;target.mkdir(parents=True,exist_ok=True)
 if (target/'result.mp4').exists():raise ValueError('Output already exists')
 python=sys.executable
 if args.engine=='neural':
  if not smart_ready():raise ValueError('Neural model is not validated; install/verify it first')
  python=json.loads((HELPER/'.runtime/smart-ready.json').read_text())['python']
 spec=case['spec'];clips=[];reports=[];identity=build_id(HELPER);started=time.perf_counter()
 for index in range(math.ceil(spec['duration']/4)):
  start=index*4;length=min(4,spec['duration']-start);file=target/f'chunk-{index}.mp4'
  command=[python,str(HELPER/'smart_runner.py'),'--source',str(folder/'input.mp4'),'--output',str(file),'--width',str(spec['width']),'--height',str(spec['height']),'--fps',str(spec['fps']),'--start',str(start),'--duration',str(length),'--scale','1']
  if args.engine=='neural':command.append('--neural')
  result=run(command,text=True);(target/f'chunk-{index}.jsonl').write_text(result.stdout);reports.append(json.loads(result.stdout.splitlines()[-1]));clips.append(file)
 concat=target/'concat.txt';concat.write_text(''.join("file '"+file.name+"'\n" for file in clips));output=target/'result.mp4'
 run(['ffmpeg','-nostdin','-v','error','-f','concat','-safe','1','-i',str(concat),'-c','copy','-movflags','+faststart',str(output)])
 elapsed=time.perf_counter()-started;info=validate(spec,output);case['outputs'][args.engine]={'file':str(output.relative_to(folder)),**info,'sha256':sha(output),'elapsedSeconds':round(elapsed,3),'renderedFPS':round(spec['fps']*info['duration']/elapsed,2),'neuralInvocations':sum(r.get('neuralInvocations',0) for r in reports),'appliedEngines':sorted(set(r['engine'] for r in reports)),'helperBuildId':identity,'helperBuildChanged':build_id(HELPER)!=identity};save(folder,case);return case['outputs'][args.engine]

def external(args):
 if not re.fullmatch('[a-zA-Z0-9_-]{1,32}',args.label):raise ValueError('Use a short engine label')
 folder=args.case.resolve();case=load(folder)
 if args.elapsed is not None and (not math.isfinite(args.elapsed) or args.elapsed<=0):raise ValueError('Elapsed time must be positive and finite')
 info=validate(case['spec'],args.file);target=folder/'outputs'/args.label;target.mkdir(parents=True,exist_ok=True);output=target/'result.mp4'
 if output.exists():raise ValueError('Output already registered')
 shutil.copy2(args.file,output);case['outputs'][args.label]={'file':str(output.relative_to(folder)),**info,'sha256':sha(output),'elapsedSeconds':args.elapsed,'renderedFPS':round(case['spec']['fps']*info['duration']/args.elapsed,2) if args.elapsed else None};save(folder,case);return case['outputs'][args.label]

def report(args):
 folder=args.case.resolve();case=load(folder);choices=[(name,folder/info['file']) for name,info in case['outputs'].items()]
 if len(choices)<2:choices.append(('input',folder/'input.mp4'))
 if len(choices)<2:raise ValueError('Render at least one output first')
 selected=choices[:2] if not args.engines else [(name,folder/case['outputs'][name]['file']) for name in args.engines.split(',')]
 if len(selected)!=2:raise ValueError('Select exactly two engines')
 if len({name for name,file in selected})!=2:raise ValueError('Select two distinct engines')
 identities={}
 for name,file in selected:
  expected=case['inputSHA256'] if name=='input' else case['outputs'][name]['sha256']
  if sha(file)!=expected:raise ValueError('Comparison output changed: '+name)
  identities[name]=expected
 session_path=folder/'review-session.json'
 previous=json.loads(session_path.read_text()) if session_path.exists() else None
 if previous and previous['identities']==identities:
  session=previous
 else:
  secrets.SystemRandom().shuffle(selected)
  session={'reviewId':uuid.uuid4().hex,'inputSHA256':case['inputSHA256'],'identities':identities,'mapping':{label:name for label,(name,file) in zip(['A','B'],selected)}}
  session_path.write_text(json.dumps(session,indent=2))
 blind=folder/'blind';blind.mkdir(exist_ok=True);key=session['mapping']
 for label,name in key.items():
  file=folder/'input.mp4' if name=='input' else folder/case['outputs'][name]['file']
  target=blind/(label+'.mp4');target.unlink(missing_ok=True)
  try:os.link(file,target)
  except OSError:shutil.copy2(file,target)
 (folder/'answer-key.json').write_text(json.dumps(key,indent=2))
 metrics={name:dict(info) for name,info in case['outputs'].items()}
 for name,info in metrics.items():
  if sha(folder/info['file'])!=info['sha256']:raise ValueError('Comparison output changed: '+name)
 if (folder/'reference.mp4').exists():
  for name,info in metrics.items():
   result=run(['ffmpeg','-v','info','-i',str(folder/info['file']),'-i',str(folder/'reference.mp4'),'-lavfi','[0:v]setpts=PTS-STARTPTS,format=yuv420p[a];[1:v]setpts=PTS-STARTPTS,format=yuv420p[b];[a][b]ssim','-f','null','-'],text=True)
   values=re.findall(r'All:([0-9.]+)',result.stderr);info['referenceSSIM']=float(values[-1]) if values else None
 (folder/'metrics.json').write_text(json.dumps({'sameInputSHA256':case['inputSHA256'],'outputs':metrics,'externalComparisonPending':'topaz' not in metrics},indent=2))
 html='''<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>WeScreen blind video review</title><style>body{background:#141619;color:#eceef0;font:16px system-ui;margin:32px;line-height:1.6}main{max-width:1280px;margin:auto}.pair{display:grid;grid-template-columns:1fr 1fr;gap:24px}video{width:100%;background:#08090a}button,select{padding:10px 16px;font:inherit;background:#25292d;color:white;border:1px solid #687079;border-radius:6px}label{display:block;margin:16px 0}fieldset{margin-top:24px;border:1px solid #555}textarea{width:100%;min-height:90px}@media(max-width:700px){.pair{grid-template-columns:1fr}}</style><main><h1>盲评：A / B</h1><p>按同一时间观察文字、纹理、运动闪烁、肤色和噪声。先评分，再查看 answer-key.json。两侧都不是参考真值。</p><div class="pair"><section><h2>A</h2><video id="a" src="blind/A.mp4" controls muted playsinline></video></section><section><h2>B</h2><video id="b" src="blind/B.mp4" controls muted playsinline></video></section></div><button id="play">同步播放 / 暂停</button><fieldset><legend>偏好记录</legend><form id="review"></form><label>备注<textarea id="notes"></textarea></label><button id="save">导出盲评</button></fieldset></main><script>const a=document.querySelector('#a'),b=document.querySelector('#b');document.querySelector('#play').onclick=async()=>{b.currentTime=a.currentTime;if(a.paused)await Promise.all([a.play(),b.play()]);else{a.pause();b.pause();}};a.addEventListener('seeked',()=>{if(Math.abs(a.currentTime-b.currentTime)>.08)b.currentTime=a.currentTime});for(const [id,text] of [['text','文字清晰度'],['texture','自然纹理'],['motion','运动与闪烁'],['noise','噪声控制'],['overall','整体偏好']]){const label=document.createElement('label');label.textContent=text+' ';const select=document.createElement('select');select.name=id;for(const value of ['未评分','A 更好','接近','B 更好']){const o=document.createElement('option');o.value=o.textContent=value;select.append(o)}label.append(select);document.querySelector('#review').append(label)}document.querySelector('#save').onclick=()=>{const result={reviewId:__REVIEW_ID__,inputSHA256:__INPUT_HASH__,ratings:Object.fromEntries(new FormData(document.querySelector('#review'))),notes:document.querySelector('#notes').value};const url=URL.createObjectURL(new Blob([JSON.stringify(result,null,2)],{type:'application/json'})),link=document.createElement('a');link.href=url;link.download='blind-review.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000)};</script>'''
 html=html.replace('__REVIEW_ID__',json.dumps(session['reviewId'])).replace('__INPUT_HASH__',json.dumps(case['inputSHA256']))
 (folder/'review.html').write_text(html);return {'review':str(folder/'review.html'),'externalComparisonPending':'topaz' not in metrics}

RATING_FIELDS=('text','texture','motion','noise','overall')
RATING_VALUES=('未评分','A 更好','接近','B 更好')

def score(args):
 folder=args.case.resolve();case=load(folder)
 session=json.loads((folder/'review-session.json').read_text())
 result=json.loads(args.file.read_text())
 if result.get('reviewId')!=session['reviewId'] or result.get('inputSHA256')!=case['inputSHA256']:raise ValueError('Score belongs to a different review session')
 for name,digest in session['identities'].items():
  file=folder/'input.mp4' if name=='input' else folder/case['outputs'][name]['file']
  if sha(file)!=digest:raise ValueError('Reviewed output changed')
 ratings=result.get('ratings',{})
 if set(ratings)!=set(RATING_FIELDS) or any(value not in RATING_VALUES for value in ratings.values()):raise ValueError('Invalid rating fields or values')
 if all(value=='未评分' for value in ratings.values()):raise ValueError('Review has no ratings')
 if not isinstance(result.get('notes',''),str) or len(result.get('notes',''))>10000:raise ValueError('Invalid review notes')
 canonical=json.dumps(result,sort_keys=True,ensure_ascii=False).encode()
 digest=hashlib.sha256(canonical).hexdigest();scores=folder/'scores';scores.mkdir(exist_ok=True)
 target=scores/(digest+'.json')
 duplicate=target.exists()
 if not duplicate:target.write_bytes(canonical)
 counts={field:{name:0 for name in session['mapping'].values()}|{'tie':0,'unrated':0} for field in RATING_FIELDS};reviews=0
 for file in scores.glob('*.json'):
  vote=json.loads(file.read_text())
  if vote.get('reviewId')!=session['reviewId']:continue
  reviews+=1
  for field,value in vote['ratings'].items():
   choice='unrated' if value=='未评分' else 'tie' if value=='接近' else session['mapping'][value[0]]
   counts[field][choice]+=1
 summary={'reviewId':session['reviewId'],'reviews':reviews,'preferences':counts,'note':'Descriptive votes only; no statistical quality superiority is inferred.'}
 (folder/'score-summary.json').write_text(json.dumps(summary,indent=2,ensure_ascii=False))
 return {'duplicate':duplicate,**summary}

if __name__=='__main__':
 parser=argparse.ArgumentParser();sub=parser.add_subparsers(dest='command',required=True)
 p=sub.add_parser('prepare');p.add_argument('--case',type=Path,required=True);p.add_argument('--source',type=Path,required=True);p.add_argument('--start',type=float,default=0);p.add_argument('--seconds',type=float,default=8);p.add_argument('--reference',type=Path)
 p=sub.add_parser('run');p.add_argument('--case',type=Path,required=True);p.add_argument('--engine',choices=['spatial','neural'],required=True)
 p=sub.add_parser('add');p.add_argument('--case',type=Path,required=True);p.add_argument('--file',type=Path,required=True);p.add_argument('--label',required=True);p.add_argument('--elapsed',type=float)
 p=sub.add_parser('report');p.add_argument('--case',type=Path,required=True);p.add_argument('--engines')
 p=sub.add_parser('score');p.add_argument('--case',type=Path,required=True);p.add_argument('--file',type=Path,required=True)
 args=parser.parse_args();print(json.dumps({'prepare':prepare,'run':render,'add':external,'report':report,'score':score}[args.command](args)))
