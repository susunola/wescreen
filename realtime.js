// Best-effort live neural SR. Audio and playback clock always stay on the original video.
const realtimeAI={enabled:false,busy:false,generation:0,request:0,callback:null,abort:null,edge:960,average:0,failures:0,slow:0,frames:[],mediaTime:-1,project:null,lossless:false,rgb:false,maxLong:1080,maxShort:1080,outputScale:1,engine:null,nextAt:0};
const realtimeCanvas=document.createElement('canvas');realtimeCanvas.id='realtime-ai-canvas';realtimeCanvas.hidden=true;$('playback-stage').prepend(realtimeCanvas);
const realtimeCapture=document.createElement('canvas');
const realtimeButton=document.createElement('button');realtimeButton.id='playback-realtime';realtimeButton.type='button';realtimeButton.dataset.i18n='smartRealtime';realtimeButton.textContent=L('smartRealtime');realtimeButton.setAttribute('aria-pressed','false');qualityPanel.insertBefore(realtimeButton,$('playback-instant'));
const realtimeHint=document.createElement('p');realtimeHint.className='cinema-repair-caption';realtimeHint.id='realtime-ai-status';realtimeHint.setAttribute('role','status');realtimeButton.after(realtimeHint);
function syncRealtimeLayout(){const v=$('preview');for(const key of ['width','height','transform','filter'])realtimeCanvas.style[key]=v.style[key];}
new MutationObserver(syncRealtimeLayout).observe($('preview'),{attributes:true,attributeFilter:['style']});
function stopRealtimeAI(message=''){
 realtimeAI.enabled=false;realtimeAI.generation++;realtimeAI.abort?.abort();realtimeAI.abort=null;realtimeAI.busy=false;
 if(realtimeAI.callback!==null){if($('preview').cancelVideoFrameCallback)$('preview').cancelVideoFrameCallback(realtimeAI.callback);else cancelAnimationFrame(realtimeAI.callback);}realtimeAI.callback=null;
 realtimeCanvas.hidden=true;realtimeButton.setAttribute('aria-pressed','false');realtimeHint.textContent=message;realtimeAI.frames=[];
}
function scheduleRealtimeAI(){
 if(!realtimeAI.enabled || realtimeAI.callback!==null || $('preview').paused)return;
 const video=$('preview');const callback=(_now,metadata)=>{realtimeAI.callback=null;if(!realtimeAI.enabled)return;processRealtimeFrame(metadata?.mediaTime ?? video.currentTime);scheduleRealtimeAI();};
 realtimeAI.callback=video.requestVideoFrameCallback ? video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
}
async function processRealtimeFrame(mediaTime){
 const video=$('preview');if(!realtimeAI.enabled || realtimeAI.busy || performance.now()<realtimeAI.nextAt || playbackSeeking || video.readyState<2 || document.hidden || !$('player-view').getClientRects().length)return;
 const generation=realtimeAI.generation,request=++realtimeAI.request;realtimeAI.busy=true;const started=performance.now();
 const scale=Math.min(1,(realtimeAI.rgb?realtimeAI.maxLong:960)/Math.max(video.videoWidth,video.videoHeight),(realtimeAI.rgb?realtimeAI.maxShort:540)/Math.min(video.videoWidth,video.videoHeight));
 realtimeCapture.width=Math.max(2,Math.round(video.videoWidth*scale));realtimeCapture.height=Math.max(2,Math.round(video.videoHeight*scale));
 try{
  const captureContext=realtimeCapture.getContext('2d');captureContext.imageSmoothingEnabled=true;captureContext.imageSmoothingQuality='high';
  captureContext.drawImage(video,0,0,realtimeCapture.width,realtimeCapture.height);
  const mime=realtimeAI.rgb?'application/x-wescreen-rgb':realtimeAI.lossless?'image/png':'image/jpeg';
  let frame;if(realtimeAI.rgb){const rgba=realtimeCapture.getContext('2d').getImageData(0,0,realtimeCapture.width,realtimeCapture.height).data;frame=new Uint8Array(realtimeCapture.width*realtimeCapture.height*3);for(let i=0,j=0;i<rgba.length;i+=4){frame[j++]=rgba[i];frame[j++]=rgba[i+1];frame[j++]=rgba[i+2];}}else frame=await new Promise(resolve=>realtimeCapture.toBlob(resolve,mime,.94));if(!frame)throw new Error('Frame unavailable');
  if(generation!==realtimeAI.generation)return;
  const controller=new AbortController();realtimeAI.abort=controller;const timeout=setTimeout(()=>controller.abort(),realtimeAI.rgb?5000:1800);
  let response;try{response=await enhancementRequest('/realtime/frame',{method:'POST',body:frame,headers:{'Content-Type':mime,...(realtimeAI.rgb?{'X-Frame-Width':String(realtimeCapture.width),'X-Frame-Height':String(realtimeCapture.height),'X-Protect-Text':'1',...(realtimeAI.outputScale>=2?{'X-Output-Scale':String(parseFloat(video.style.width)>video.videoWidth*1.05 || parseFloat(video.style.height)>video.videoHeight*1.05?2:1)}:{})}:{})},signal:controller.signal});}finally{clearTimeout(timeout);}
  let bitmap;if(realtimeAI.rgb){const rgb=new Uint8Array(await response.arrayBuffer()),w=Number(response.headers.get('X-Frame-Width')||realtimeCapture.width),h=Number(response.headers.get('X-Frame-Height')||realtimeCapture.height);if(!Number.isInteger(w)||!Number.isInteger(h)||w<2||h<2||w>3840||h>3840||w*h>1920*1080*4)throw new Error('Invalid RGB dimensions');if(rgb.length!==w*h*3)throw new Error('Invalid RGB result');const rgba=new Uint8ClampedArray(w*h*4);for(let i=0,j=0;i<rgb.length;i+=3){rgba[j++]=rgb[i];rgba[j++]=rgb[i+1];rgba[j++]=rgb[i+2];rgba[j++]=255;}bitmap=await createImageBitmap(new ImageData(rgba,w,h));}else bitmap=await createImageBitmap(await response.blob());
  try{
   if(generation!==realtimeAI.generation || !realtimeAI.enabled)return;
   const elapsed=performance.now()-started;realtimeAI.average=realtimeAI.average ? realtimeAI.average*.75+elapsed*.25:elapsed;
   realtimeAI.failures=0;
   // Preserve the original clock: late AI frames must not cover newer video frames.
   const timely=!playbackSeeking && Math.abs(video.currentTime-mediaTime)<=.15;
   if(!timely)realtimeCanvas.hidden=true;
   if(timely){realtimeCanvas.width=bitmap.width;realtimeCanvas.height=bitmap.height;const outputContext=realtimeCanvas.getContext('2d');outputContext.imageSmoothingEnabled=true;outputContext.imageSmoothingQuality='high';outputContext.drawImage(bitmap,0,0);syncRealtimeLayout();realtimeAI.mediaTime=mediaTime;realtimeCanvas.hidden=false;realtimeAI.frames.push(performance.now());realtimeAI.frames=realtimeAI.frames.slice(-20);}
   realtimeAI.nextAt=performance.now()+Math.max(0,realtimeAI.average-33);
   const frames=realtimeAI.frames,fps=frames.length>1 ? Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0])):0;
   realtimeHint.textContent=(realtimeAI.engine || 'FSRCNN fallback')+` · ${bitmap.width}×${bitmap.height}${fps ? ` · ${fps} fps`:''}`+E(' · 速度不足时隔帧，分辨率固定',' · Frames skipped under load; resolution stays fixed');
  }finally{bitmap.close();}
 }catch(error){if(generation===realtimeAI.generation){realtimeCanvas.hidden=true;realtimeHint.textContent=E('本机程序忙或连接中断，当前显示原画。','Helper busy or unavailable; showing original.');if(++realtimeAI.failures>=6)stopRealtimeAI(E('实时 AI 已停止：请检查本机程序，原视频继续播放。','Realtime AI stopped: check the local helper. Original keeps playing.'));}}
 finally{if(request===realtimeAI.request)realtimeAI.busy=false;}
}
realtimeButton.onclick=async()=>{
 if(realtimeAI.enabled){stopRealtimeAI();return;}
 realtimeButton.disabled=true;realtimeHint.textContent=E('正在检查实时 AI…','Checking realtime AI…');const source=activePlaybackId;
 try{const health=await connectHelper();if(source!==activePlaybackId)return;
  const entry=activePlaybackId ? await readStore('recordings',activePlaybackId):null;if(source!==activePlaybackId)return;
  if($('realtime-text-protect')?.checked && entry?.captureContent==='detail'){realtimeHint.textContent=E('桌面文字保护已开启，保持原画。','Desktop text protection keeps the original.');return;}
  if(Math.max($('preview').videoWidth,$('preview').videoHeight)>1920 || Math.min($('preview').videoWidth,$('preview').videoHeight)>1080){realtimeHint.textContent=E('高清源保持原画，避免缩小后再放大。需要修复请使用后台自然修复。','Keeping the high-resolution original. Use background Natural restoration for repair.');return;}
  if(!health?.realtime){realtimeHint.textContent=E('请启动或更新本机增强包；需要支持实时 AI 的新版程序。','Start or update the local helper to support realtime AI.');return;}
  realtimeAI.enabled=true;realtimeAI.project=playbackProjectId();realtimeAI.lossless=!!health.realtimeLossless;realtimeAI.rgb=!!health.realtimeRGB;realtimeAI.maxLong=health.realtimeRGBMaxWidth||1080;realtimeAI.maxShort=health.realtimeRGBMaxHeight||1080;realtimeAI.outputScale=health.realtimeOutputScale||1;realtimeAI.engine=health.realtimeEngine || 'FSRCNN fallback';realtimeAI.nextAt=0;realtimeAI.generation++;realtimeAI.edge=960;realtimeAI.average=0;realtimeAI.failures=0;realtimeAI.slow=0;realtimeAI.frames=[];realtimeButton.setAttribute('aria-pressed','true');
  processRealtimeFrame($('preview').currentTime);scheduleRealtimeAI();
 }finally{realtimeButton.disabled=false;}
};
originalPicture.addEventListener('click',()=>stopRealtimeAI());
$('preview').addEventListener('play',scheduleRealtimeAI);
$('preview').addEventListener('seeking',()=>{realtimeAI.generation++;realtimeAI.request++;realtimeAI.busy=false;realtimeAI.nextAt=0;realtimeAI.abort?.abort();realtimeCanvas.hidden=true;});
$('preview').addEventListener('seeked',()=>{if(realtimeAI.enabled)processRealtimeFrame($('preview').currentTime);});
$('preview').addEventListener('pause',()=>{if(realtimeAI.enabled){realtimeAI.generation++;realtimeAI.request++;realtimeAI.abort?.abort();realtimeAI.busy=false;realtimeAI.nextAt=0;processRealtimeFrame($('preview').currentTime);}});
$('preview').addEventListener('loadedmetadata',()=>{
 if(!realtimeAI.enabled)return;
 const v=$('preview');if(realtimeAI.project!==playbackProjectId() || Math.max(v.videoWidth,v.videoHeight)>1920 || Math.min(v.videoWidth,v.videoHeight)>1080){stopRealtimeAI();return;}
 realtimeAI.generation++;realtimeAI.request++;realtimeAI.abort?.abort();realtimeAI.busy=false;realtimeCanvas.hidden=true;realtimeAI.mediaTime=-1;
 processRealtimeFrame(v.currentTime);scheduleRealtimeAI();
});
window.addEventListener('pagehide',()=>stopRealtimeAI());
new MutationObserver(()=>{if($('player-view').classList.contains('hidden'))stopRealtimeAI();}).observe($('player-view'),{attributes:true,attributeFilter:['class']});
