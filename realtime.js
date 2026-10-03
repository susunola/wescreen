// Best-effort live neural SR. Audio and playback clock always stay on the original video.
const realtimeAI={enabled:false,busy:false,generation:0,request:0,callback:null,abort:null,edge:960,average:0,failures:0,slow:0,frames:[],mediaTime:-1};
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
 const video=$('preview');const callback=(_now,metadata)=>{realtimeAI.callback=null;if(!realtimeAI.enabled)return;if(Math.abs(video.currentTime-realtimeAI.mediaTime)>.1)realtimeCanvas.hidden=true;processRealtimeFrame(metadata?.mediaTime ?? video.currentTime);scheduleRealtimeAI();};
 realtimeAI.callback=video.requestVideoFrameCallback ? video.requestVideoFrameCallback(callback):requestAnimationFrame(callback);
}
async function processRealtimeFrame(mediaTime){
 const video=$('preview');if(!realtimeAI.enabled || realtimeAI.busy || playbackSeeking || video.readyState<2 || document.hidden || !$('result').getClientRects().length)return;
 const generation=realtimeAI.generation,request=++realtimeAI.request;realtimeAI.busy=true;const started=performance.now();
 const scale=Math.min(1,realtimeAI.edge/Math.max(video.videoWidth,video.videoHeight),540/Math.min(video.videoWidth,video.videoHeight));
 realtimeCapture.width=Math.max(2,Math.round(video.videoWidth*scale));realtimeCapture.height=Math.max(2,Math.round(video.videoHeight*scale));
 try{
  realtimeCapture.getContext('2d').drawImage(video,0,0,realtimeCapture.width,realtimeCapture.height);
  const frame=await new Promise(resolve=>realtimeCapture.toBlob(resolve,'image/jpeg',.94));if(!frame)throw new Error('Frame unavailable');
  if(generation!==realtimeAI.generation)return;
  realtimeAI.abort=new AbortController();const timeout=setTimeout(()=>realtimeAI.abort?.abort(),1800);
  let response;try{response=await enhancementRequest('/realtime/frame',{method:'POST',body:frame,headers:{'Content-Type':'image/jpeg'},signal:realtimeAI.abort.signal});}finally{clearTimeout(timeout);}
  const bitmap=await createImageBitmap(await response.blob());
  try{
   if(generation!==realtimeAI.generation || !realtimeAI.enabled)return;
   const elapsed=performance.now()-started;realtimeAI.average=realtimeAI.average ? realtimeAI.average*.75+elapsed*.25:elapsed;
   realtimeAI.failures=0;
   // Discard late results after seeks or when inference cannot keep up with audio.
   const timely=Math.abs(video.currentTime-mediaTime)<=.1 && ($('realtime-strategy')?.value==='smooth' || (bitmap.width>=video.videoWidth && bitmap.height>=video.videoHeight));
   if(timely){realtimeCanvas.width=bitmap.width;realtimeCanvas.height=bitmap.height;realtimeCanvas.getContext('2d').drawImage(bitmap,0,0);syncRealtimeLayout();realtimeAI.mediaTime=mediaTime;realtimeCanvas.hidden=false;realtimeAI.slow=0;realtimeAI.frames.push(performance.now());realtimeAI.frames=realtimeAI.frames.slice(-20);}
   else{realtimeCanvas.hidden=true;realtimeAI.slow++;}
   if(realtimeAI.average>65 && realtimeAI.edge>320)realtimeAI.edge=Math.max(320,Math.floor(realtimeAI.edge*.8/16)*16);
   const frames=realtimeAI.frames,fps=frames.length>1 ? Math.round((frames.length-1)*1000/(frames.at(-1)-frames[0])):0;
   realtimeHint.textContent=timely ? `FSRCNN 2× · ${bitmap.width}×${bitmap.height}${fps ? ` · ${fps} fps`:''}`:E('处理速度不足，当前显示原画；正在降低 AI 负载。','Showing original; reducing AI workload to keep playback smooth.');
   if(realtimeAI.slow>=8 && realtimeAI.edge<=320)stopRealtimeAI(E('本机无法保持实时 AI，已恢复原画。请使用 AI 高清修复后台另存。','Realtime AI cannot keep up. Original restored; use background AI repair.'));
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
  realtimeAI.enabled=true;realtimeAI.generation++;realtimeAI.edge=960;realtimeAI.average=0;realtimeAI.failures=0;realtimeAI.slow=0;realtimeAI.frames=[];realtimeButton.setAttribute('aria-pressed','true');
  processRealtimeFrame($('preview').currentTime);scheduleRealtimeAI();
 }finally{realtimeButton.disabled=false;}
};
originalPicture.addEventListener('click',()=>stopRealtimeAI());
$('preview').addEventListener('play',scheduleRealtimeAI);
$('preview').addEventListener('seeking',()=>{realtimeAI.generation++;realtimeAI.abort?.abort();realtimeCanvas.hidden=true;});
$('preview').addEventListener('seeked',()=>{if(realtimeAI.enabled)processRealtimeFrame($('preview').currentTime);});
$('preview').addEventListener('pause',()=>{if(realtimeAI.enabled)processRealtimeFrame($('preview').currentTime);});
$('preview').addEventListener('loadedmetadata',()=>stopRealtimeAI());
window.addEventListener('pagehide',()=>stopRealtimeAI());
new MutationObserver(()=>{if($('result').classList.contains('hidden'))stopRealtimeAI();}).observe($('result'),{attributes:true,attributeFilter:['class']});
