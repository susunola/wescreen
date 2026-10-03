// Fixed-region local fill, with mandatory preview. Original bytes stay in the library.
const watermarkDialog=document.createElement('dialog');watermarkDialog.id='watermark-panel';
const watermarkHeader=document.createElement('div');watermarkHeader.className='watermark-header';
watermarkHeader.append(polishLabel(document.createElement('h2'),'局部水印填补','Local watermark fill'));
polishButton('watermark-close','关闭','Close',()=>watermarkDialog.close(),watermarkHeader);
const watermarkHint=polishLabel(document.createElement('p'),'拖动圈选固定水印，先预览再另存。填补可能留下痕迹；靠边水印请使用裁剪。','Drag to select a fixed watermark; preview before saving. Filling may leave artifacts. Crop edge watermarks instead.');watermarkHint.className='hint';
const watermarkCompare=document.createElement('div');watermarkCompare.className='watermark-compare';
const watermarkStage=document.createElement('div');watermarkStage.className='watermark-stage';
const watermarkOriginal=document.createElement('video');watermarkOriginal.id='watermark-original';watermarkOriginal.preload='metadata';watermarkOriginal.playsInline=true;
const watermarkRegion=document.createElement('div');watermarkRegion.className='watermark-region';watermarkRegion.hidden=true;watermarkStage.append(watermarkOriginal,watermarkRegion);
const watermarkOutput=document.createElement('video');watermarkOutput.id='watermark-output';watermarkOutput.controls=true;watermarkOutput.playsInline=true;watermarkCompare.append(watermarkStage,watermarkOutput);
const watermarkFields=document.createElement('div');watermarkFields.className='watermark-fields';
for(const [name,zh,en] of [['x','左','Left'],['y','上','Top'],['w','宽','Width'],['h','高','Height']]){const label=document.createElement('label');label.append(polishLabel(document.createElement('span'),zh,en));const input=document.createElement('input');input.id='watermark-'+name;input.type='number';input.min=name==='w'||name==='h'?'4':'1';input.step='1';label.append(input);watermarkFields.append(label);input.oninput=()=>{watermarkPreviewKey=null;watermarkSave.disabled=true;drawWatermarkRegion();};}
const watermarkSeek=document.createElement('input');watermarkSeek.id='watermark-seek';watermarkSeek.type='range';watermarkSeek.min='0';watermarkSeek.max='0';watermarkSeek.step='.1';watermarkSeek.value='0';watermarkSeek.setAttribute('aria-label',E('选择预览位置','Choose preview position'));watermarkSeek.oninput=()=>watermarkOriginal.currentTime=Number(watermarkSeek.value);
const watermarkActions=document.createElement('div');watermarkActions.className='controls';
polishButton('watermark-play','播放 / 暂停原视频','Play / pause source',()=>watermarkOriginal.paused?watermarkOriginal.play():watermarkOriginal.pause(),watermarkActions);
const watermarkPreview=polishButton('watermark-preview','预览 5 秒','Preview 5 seconds',()=>runWatermark(true),watermarkActions);
const watermarkSave=polishButton('watermark-save','填补整段并另存','Fill full video and save',()=>runWatermark(false),watermarkActions);watermarkSave.disabled=true;
polishButton('watermark-crop','改用裁剪','Use crop instead',()=>{const source=watermarkSource;watermarkDialog.close();if(source)openVideoEditor(source).catch(error=>setNotice(error.message));},watermarkActions);
const watermarkProgress=document.createElement('progress');watermarkProgress.max=1;watermarkProgress.hidden=true;
const watermarkStatus=document.createElement('p');watermarkStatus.id='watermark-status';watermarkStatus.setAttribute('role','status');
watermarkDialog.append(watermarkHeader,watermarkHint,watermarkCompare,watermarkSeek,watermarkFields,watermarkActions,watermarkProgress,watermarkStatus);document.body.append(watermarkDialog);
let watermarkSource=null,watermarkUrls=[],watermarkBusy=false,watermarkPreviewKey=null,watermarkGeneration=0;
polishButton('player-watermark','局部水印填补…','Local watermark fill…',async()=>{try{const source=await readStore('recordings',finalId);if(!source||source.deletedAt)throw new Error(L('errEmpty'));await openWatermark(source);}catch(error){setNotice(error.message);}},proPlayerTools);
async function openWatermark(source){
 if(watermarkBusy)return;const blob=await readStore('videos',source.id);if(!blob)throw new Error(L('errEmpty'));
 watermarkSource=source;watermarkPreviewKey=null;watermarkSave.disabled=true;watermarkStatus.textContent='';watermarkGeneration++;
 const url=URL.createObjectURL(blob);watermarkUrls.push(url);watermarkOriginal.src=url;watermarkOriginal.currentTime=0;watermarkDialog.showModal();
}
function watermarkValues(){const values=['x','y','w','h'].map(name=>Number($('watermark-'+name).value));const [x,y,w,h]=values;
 if(!values.every(Number.isInteger)||x<1||y<1||w<4||h<4||x+w>=watermarkOriginal.videoWidth||y+h>=watermarkOriginal.videoHeight)throw new Error(E('请圈选画面内部区域，四周至少留 1 像素；宽高至少 4 像素。','Select an interior region, leaving a 1-pixel border; minimum size 4×4 pixels.'));return values;
}
function watermarkBounds(){const r=watermarkStage.getBoundingClientRect(),v=watermarkOriginal,scale=Math.min(r.width/v.videoWidth,r.height/v.videoHeight);return {scale,x:(r.width-v.videoWidth*scale)/2,y:(r.height-v.videoHeight*scale)/2,r};}
function drawWatermarkRegion(){if(!watermarkOriginal.videoWidth)return;try{const [x,y,w,h]=watermarkValues(),bounds=watermarkBounds();Object.assign(watermarkRegion.style,{left:(bounds.x+x*bounds.scale)+'px',top:(bounds.y+y*bounds.scale)+'px',width:w*bounds.scale+'px',height:h*bounds.scale+'px'});watermarkRegion.hidden=false;}catch{watermarkRegion.hidden=true;}}
watermarkOriginal.addEventListener('loadedmetadata',()=>{const v=watermarkOriginal;watermarkSeek.max=String(Number.isFinite(v.duration)?v.duration:watermarkSource.duration/1000);for(const [key,value] of Object.entries({x:Math.max(1,Math.floor(v.videoWidth*.1)),y:Math.max(1,Math.floor(v.videoHeight*.1)),w:Math.max(4,Math.floor(v.videoWidth*.15)),h:Math.max(4,Math.floor(v.videoHeight*.1))}))$('watermark-'+key).value=String(value);drawWatermarkRegion();});
watermarkOriginal.addEventListener('timeupdate',()=>watermarkSeek.value=String(watermarkOriginal.currentTime));
let watermarkDrag=null;
watermarkStage.onpointerdown=event=>{if(!watermarkOriginal.videoWidth||watermarkBusy)return;event.preventDefault();watermarkOriginal.pause();const b=watermarkBounds();const point={x:Math.round((event.clientX-b.r.left-b.x)/b.scale),y:Math.round((event.clientY-b.r.top-b.y)/b.scale)};watermarkDrag=point;watermarkStage.setPointerCapture(event.pointerId);};
watermarkStage.onpointermove=event=>{if(!watermarkDrag)return;const b=watermarkBounds(),v=watermarkOriginal,x=Math.round((event.clientX-b.r.left-b.x)/b.scale),y=Math.round((event.clientY-b.r.top-b.y)/b.scale),left=Math.max(1,Math.min(v.videoWidth-6,Math.min(x,watermarkDrag.x))),top=Math.max(1,Math.min(v.videoHeight-6,Math.min(y,watermarkDrag.y))),w=Math.max(4,Math.min(v.videoWidth-left-1,Math.abs(x-watermarkDrag.x))),h=Math.max(4,Math.min(v.videoHeight-top-1,Math.abs(y-watermarkDrag.y)));
 for(const [key,value] of Object.entries({x:left,y:top,w,h}))$('watermark-'+key).value=String(value);watermarkPreviewKey=null;watermarkSave.disabled=true;drawWatermarkRegion();};
for(const name of ['pointerup','pointercancel','lostpointercapture'])watermarkStage.addEventListener(name,()=>watermarkDrag=null);
new ResizeObserver(drawWatermarkRegion).observe(watermarkStage);
async function runWatermark(preview){
 if(watermarkBusy||!watermarkSource)return;const source=watermarkSource,generation=watermarkGeneration;let task=null;
 try{
  const region=watermarkValues(),key=source.id+':'+region.join(',');if(!preview&&watermarkPreviewKey!==key)throw new Error(E('请先预览当前选区。','Preview the current region first.'));
  watermarkBusy=true;watermarkPreview.disabled=true;watermarkSave.disabled=true;watermarkProgress.hidden=false;watermarkProgress.value=0;watermarkOriginal.pause();watermarkOutput.pause();watermarkStatus.textContent=E('正在本机处理…原视频保留。','Processing locally… original retained.');
  if(!helperHealth)await connectHelper({repair:true});if(!helperHealth?.watermark)throw new Error(E('请启动支持局部填补的新版本机增强包。','Start the updated helper with local fill support.'));
  task=await submitProcessing(source,{mode:'watermark',preview,watermark:region,start:preview?Math.max(0,Math.min(watermarkOriginal.currentTime,Number(watermarkSeek.max)-.1)):0,previewSeconds:5});
  while(true){const info=await(await enhancementRequest('/jobs/'+task.id)).json();if(generation===watermarkGeneration)watermarkProgress.value=info.progress||0;
   if(info.state==='error'||info.state==='cancelled')throw new Error(info.error||L('jobCancelled'));
   if(info.state==='done'){
    if(preview){const blob=await(await enhancementRequest('/jobs/'+task.id+'/result')).blob();if(generation===watermarkGeneration){const url=URL.createObjectURL(blob);watermarkUrls.push(url);watermarkOutput.src=url;watermarkPreviewKey=key;watermarkStatus.textContent=E('预览完成。检查填补痕迹，满意后再另存整段。','Preview ready. Check artifacts before saving the full video.');}await enhancementRequest('/jobs/'+task.id,{method:'DELETE'}).catch(()=>{});await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').delete(task.id));}
    else{await saveTaskResult({...task,...info});if(generation===watermarkGeneration)watermarkStatus.textContent=E('填补版已存入录像库，原视频保留。','Filled version saved to the library; original retained.');}
    break;
   }await new Promise(r=>setTimeout(r,500));
  }
 }catch(error){if(generation===watermarkGeneration)watermarkStatus.textContent=error.message+(!preview&&task?E(' 结果可在视频处理页重试保存。',' Retry saving the result in Video processing.'):'');}
 finally{watermarkBusy=false;watermarkPreview.disabled=false;watermarkSave.disabled=!watermarkPreviewKey;watermarkProgress.hidden=true;}
}
watermarkDialog.addEventListener('close',()=>{watermarkGeneration++;watermarkPreviewKey=null;watermarkSource=null;for(const video of [watermarkOriginal,watermarkOutput]){video.pause();video.removeAttribute('src');video.load();}for(const url of watermarkUrls)URL.revokeObjectURL(url);watermarkUrls=[];watermarkRegion.hidden=true;});
