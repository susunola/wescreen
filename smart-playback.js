// Background restoration overlays only synchronized, completed video chunks.
// The original video is always the audio/transport clock. Private cache is ephemeral.
const smartBackground={enabled:false,generation:0,session:null,abort:null,busy:false,poll:null,callback:null,chunkSeconds:4,chunks:new Map(),bytes:0,current:-1,source:null,pending:null,failed:new Set(),status:null,stage:'',started:0,pendingStarted:0};
let smartSubtitleTrack=null,smartSubtitleSource=null,smartSubtitleKey='';
const smartVideo=document.createElement('video');smartVideo.id='smart-restored-video';smartVideo.muted=true;smartVideo.playsInline=true;smartVideo.preload='auto';smartVideo.hidden=true;$('playback-stage').prepend(smartVideo);
function smartProgressText(){
 const info=smartBackground.status,elapsed=Math.max(0,Math.floor((performance.now()-(smartBackground.pendingStarted||smartBackground.started))/1000));
 if(smartBackground.stage==='error')return E('修复暂不可用 · 当前原画','Repair unavailable · Original');
 if(!smartBackground.session)return E('准备修复','Preparing repair')+` · ${elapsed}s`;
 if(smartBackground.pending===null)return E('等待当前片段缓存','Waiting for current chunk');
 const progress=Math.max(0,Math.min(1,Number(info?.progress)||0)),percent=Math.floor(progress*100);
 const position=smartBackground.pending*smartBackground.chunkSeconds;
 const range=`${formatSmartTime(position)}–${formatSmartTime(position+smartBackground.chunkSeconds)}`;
 let timing=E(`已用 ${elapsed} 秒`,`Elapsed ${elapsed}s`);
 if(progress>=.1&&progress<.98&&elapsed>=2){const remaining=Math.max(1,Math.ceil(elapsed*(1-progress)/progress));timing=E(`预计还需约 ${remaining} 秒`,`About ${remaining}s remaining`);}
 else if(progress>=.98)timing=E('正在完成封装','Finalizing chunk');
 return E('修复片段','Repairing chunk')+` ${range} · ${percent}% · ${timing}`;
}
function formatSmartTime(seconds){return `${Math.floor(seconds/60).toString().padStart(2,'0')}:${Math.floor(seconds%60).toString().padStart(2,'0')}`;}
function updateSmartBadge(){
 if(!smartBackground.enabled){enhancementBadge.hidden=!instantEnhancement;enhancementBadge.textContent=E('增强已开启','Enhancement on');enhancementBadge.removeAttribute('title');return;}
 enhancementBadge.hidden=false;
 const status=smartProgressText();
 enhancementBadge.textContent=smartVideo.hidden?status:E('智能最佳 · 修复缓存','Smart best · Restored cache');
 enhancementBadge.title=status+E(' · 当前片段进度，非整段视频；当前原画可正常播放',' · Current chunk, not whole video; original playback continues');
 if(smartVideo.hidden)realtimeHint.textContent=enhancementBadge.title;
}
setInterval(()=>{if(smartBackground.enabled)updateSmartBadge();},1000);
new MutationObserver(updateSmartBadge).observe(smartVideo,{attributes:true,attributeFilter:['hidden']});
window.addEventListener('wescreen-language',updateSmartBadge);
function syncSmartLayout(){const v=$('preview');for(const key of ['width','height','transform'])smartVideo.style[key]=v.style[key];smartVideo.style.filter='none';}
new MutationObserver(syncSmartLayout).observe($('preview'),{attributes:true,attributeFilter:['style']});
function stopSmartBackground(){
 const old=smartBackground.session;smartBackground.enabled=false;smartBackground.generation++;smartBackground.abort?.abort();smartBackground.abort=null;clearTimeout(smartBackground.poll);smartBackground.poll=null;
 if(smartBackground.callback!==null){$('preview').cancelVideoFrameCallback?.(smartBackground.callback);cancelAnimationFrame(smartBackground.callback);}smartBackground.callback=null;
 smartSubtitleKey='';smartSubtitleSource=null;if(smartSubtitleTrack){smartSubtitleTrack.mode='disabled';for(const cue of [...(smartSubtitleTrack.cues||[])])smartSubtitleTrack.removeCue(cue);}
 smartVideo.hidden=true;smartVideo.pause();smartVideo.removeAttribute('src');smartVideo.load();
 for(const chunk of smartBackground.chunks.values())URL.revokeObjectURL(chunk.url);
 smartBackground.chunks.clear();smartBackground.failed.clear();smartBackground.bytes=0;smartBackground.current=-1;smartBackground.session=null;smartBackground.pending=null;smartBackground.busy=false;smartBackground.source=null;smartBackground.status=null;smartBackground.stage='';smartBackground.started=0;smartBackground.pendingStarted=0;
 updateSmartBadge();
 if(old)enhancementRequest('/smart/'+old,{method:'DELETE',keepalive:true,signal:AbortSignal.timeout(15000)}).catch(()=>{});
}
function smartCachePut(index,blob,info){
 if(blob.size>128*1024*1024)throw new Error('Smart chunk exceeds browser cache limit');
 const previous=smartBackground.chunks.get(index);if(previous){URL.revokeObjectURL(previous.url);smartBackground.bytes-=previous.size;}
 smartBackground.chunks.delete(index);smartBackground.chunks.set(index,{url:URL.createObjectURL(blob),size:blob.size,info});smartBackground.bytes+=blob.size;
 for(const [key,chunk] of smartBackground.chunks){if(smartBackground.bytes<=128*1024*1024&&smartBackground.chunks.size<=6)break;if(key===smartBackground.current||key===index)continue;URL.revokeObjectURL(chunk.url);smartBackground.bytes-=chunk.size;smartBackground.chunks.delete(key);}
 if(smartBackground.bytes>128*1024*1024){const current=smartBackground.chunks.get(smartBackground.current);if(current&&smartBackground.current!==index){smartVideo.hidden=true;smartVideo.pause();smartVideo.removeAttribute('src');URL.revokeObjectURL(current.url);smartBackground.bytes-=current.size;smartBackground.chunks.delete(smartBackground.current);smartBackground.current=-1;}}
}
function smartStatus(info){
 smartBackground.status=info||null;smartBackground.stage=info?.state==='error'?'error':'';updateSmartBadge();
 const analysis=info?.analysis;
 realtimeHint.textContent=info?.state==='done'?(info.engine||E('保守修复','Conservative repair'))+E(' · 已缓存，可直接观看',' · Cached for playback')+(analysis?.soft?E(' · 低细节来源',' · Soft source'):''):E('正在后台修复 · 原视频正常播放','Restoring in background · Original playback continues');
}
function scheduleSmartPresentation(){
 if(!smartBackground.enabled||smartBackground.callback!==null||$('preview').paused)return;
 const v=$('preview');const tick=()=>{smartBackground.callback=null;if(!smartBackground.enabled)return;presentSmartChunk();scheduleSmartPresentation();};
 smartBackground.callback=v.requestVideoFrameCallback?v.requestVideoFrameCallback(tick):requestAnimationFrame(tick);
}
function syncSmartSubtitles(start){
 const source=typeof playerSubtitleTrack!=='undefined'?playerSubtitleTrack?.track:null;
 const cues=source?.cues;const key=[smartBackground.current,cues?.length,cues?.[0]?.startTime,cues?.[0]?.text,source?.mode].join('|');
 if(key===smartSubtitleKey&&source===smartSubtitleSource)return;
 smartSubtitleKey=key;smartSubtitleSource=source;
 if(!smartSubtitleTrack&&source)smartSubtitleTrack=smartVideo.addTextTrack('subtitles');
 if(!smartSubtitleTrack)return;
 for(const cue of [...(smartSubtitleTrack.cues||[])])smartSubtitleTrack.removeCue(cue);
 smartSubtitleTrack.mode=source?.mode==='showing'?'showing':'disabled';
 if(!cues)return;
 for(const cue of [...cues]){if(cue.endTime<=start||cue.startTime>=start+smartVideo.duration)continue;const item=new VTTCue(Math.max(0,cue.startTime-start),cue.endTime-start,cue.text);for(const prop of ['line','align','position','size','vertical'])item[prop]=cue[prop];smartSubtitleTrack.addCue(item);}
}
function presentSmartChunk(){
 const v=$('preview');if(!smartBackground.enabled||playbackSeeking||document.hidden||!$('player-view').getClientRects().length){smartVideo.hidden=true;return;}
 const index=Math.floor(v.currentTime/smartBackground.chunkSeconds),chunk=smartBackground.chunks.get(index);
 if(!chunk){smartVideo.hidden=true;smartVideo.pause();return;}
 if(index!==smartBackground.current){smartBackground.current=index;smartVideo.hidden=true;smartVideo.pause();smartVideo.src=chunk.url;smartVideo.load();smartStatus(chunk.info);}
 if(smartVideo.readyState<2){smartVideo.hidden=true;return;}
 const time=v.currentTime-chunk.info.start;
 const drift=time-smartVideo.currentTime;
 if(time<0||time>=smartVideo.duration){smartVideo.hidden=true;return;}
 if(Math.abs(drift)>(v.paused?.015:.35)){smartVideo.hidden=true;if(!smartVideo.seeking)smartVideo.currentTime=Math.max(0,Math.min(time,smartVideo.duration||time));if(!v.paused)smartVideo.play().catch(()=>{});return;}
 // Catch up while hidden rather than repeatedly seeking a moving clock.
 smartVideo.playbackRate=v.playbackRate*(Math.abs(drift)>.06?(drift>0?1.2:.8):1);
 if(v.paused)smartVideo.pause();else if(smartVideo.paused)smartVideo.play().catch(()=>{smartVideo.hidden=true;});
 syncSmartLayout();syncSmartSubtitles(chunk.info.start);realtimeCanvas.hidden=true;
 smartVideo.hidden=smartVideo.seeking||Math.abs(drift)>.08||(!v.paused&&smartVideo.paused);
}
async function pumpSmartChunks(){
 if(!smartBackground.enabled||smartBackground.busy||!smartBackground.session)return;
 const generation=smartBackground.generation,session=smartBackground.session,v=$('preview');smartBackground.busy=true;
 const controller=new AbortController();smartBackground.abort=controller;
 try{
  if(smartBackground.pending!==null){
   const index=smartBackground.pending,info=await(await enhancementRequest(`/smart/${session}/chunks/${index}`,{signal:controller.signal})).json();
   if(generation!==smartBackground.generation)return;
   smartStatus(info);
   if(info.state==='done'){
    const blob=await(await enhancementRequest(`/smart/${session}/chunks/${index}?result=1`,{signal:controller.signal})).blob();
    if(generation!==smartBackground.generation)return;
    smartBackground.pending=null;try{smartCachePut(index,blob,info);}catch(error){smartBackground.failed.add(index);throw error;}presentSmartChunk();
   }else if(info.state==='error'){smartBackground.pending=null;smartBackground.failed.add(index);throw new Error(info.error||'Smart repair failed');}
  }else{
   const current=Math.floor(v.currentTime/smartBackground.chunkSeconds),count=Math.ceil(v.duration/smartBackground.chunkSeconds);
   const index=[current,current+1,current+2].find(i=>i<count&&!smartBackground.chunks.has(i)&&!smartBackground.failed.has(i));
   if(index!==undefined){await enhancementRequest(`/smart/${session}/chunks/${index}`,{method:'POST',signal:controller.signal});if(generation!==smartBackground.generation)return;smartBackground.pending=index;smartBackground.pendingStarted=performance.now();smartStatus({state:'queued',progress:0});}
  }
 }catch(error){if(generation===smartBackground.generation&&error.name!=='AbortError'){smartBackground.stage='error';updateSmartBadge();realtimeHint.textContent=E('后台修复暂不可用，原视频继续播放。','Background repair unavailable; original keeps playing.');}}
 finally{if(generation===smartBackground.generation){smartBackground.busy=false;smartBackground.poll=setTimeout(pumpSmartChunks,1000);}}
}
async function startSmartBackground(health,entry){
 if(!health?.smartChunks || !(finalBlob instanceof Blob) || typeof playerColor!=='undefined'&&playerColor.mode==='hdr')return false;
 stopSmartBackground();stopRealtimeAI();
 smartBackground.enabled=true;smartBackground.started=performance.now();updateSmartBadge();smartBackground.source=$('preview').currentSrc;const generation=++smartBackground.generation;
 realtimeHint.textContent=E('正在准备本机修复缓存 · 可继续播放','Preparing local repair cache · Playback continues');
 const controller=new AbortController();smartBackground.abort=controller;
 try{
  const result=await(await enhancementRequest('/smart/sources?content='+encodeURIComponent(entry?.captureContent||'auto'),{method:'POST',body:finalBlob,headers:{'Content-Type':finalBlob.type||'application/octet-stream'},signal:controller.signal})).json();
  if(generation!==smartBackground.generation){enhancementRequest('/smart/'+result.id,{method:'DELETE'}).catch(()=>{});return false;}
  smartBackground.session=result.id;smartBackground.chunkSeconds=result.chunkSeconds;realtimeButton.setAttribute('aria-pressed','true');
  pumpSmartChunks();scheduleSmartPresentation();return true;
 }catch(error){if(generation===smartBackground.generation){stopSmartBackground();realtimeHint.textContent=E('后台修复无法启动，使用实时轻量增强。','Background repair unavailable; using lightweight enhancement.');}return false;}
}
$('preview').addEventListener('play',()=>{presentSmartChunk();scheduleSmartPresentation();});
$('preview').addEventListener('pause',()=>{smartVideo.pause();presentSmartChunk();});
$('preview').addEventListener('seeking',()=>{smartVideo.hidden=true;smartVideo.pause();});
$('preview').addEventListener('seeked',()=>{presentSmartChunk();pumpSmartChunks();});
smartVideo.addEventListener('loadeddata',presentSmartChunk);smartVideo.addEventListener('seeked',presentSmartChunk);
$('preview').addEventListener('emptied',()=>stopSmartBackground());
window.addEventListener('pagehide',stopSmartBackground);
new MutationObserver(()=>{if($('player-view').classList.contains('hidden'))stopSmartBackground();}).observe($('player-view'),{attributes:true,attributeFilter:['class']});
originalPicture.addEventListener('click',stopSmartBackground);
// Hold-to-compare uses the same original preview underneath both enhancement layers.

async function resumeSmartPart(){
 const generation=playbackGeneration,source=$('preview').currentSrc;
 const color=await playerColorReady;if(generation!==playbackGeneration||source!==$('preview').currentSrc||color.mode==='hdr')return;
 const health=await connectHelper();if(generation!==playbackGeneration||source!==$('preview').currentSrc)return;
 const entry=activePlaybackId?await readStore('recordings',activePlaybackId):null;
 if(generation!==playbackGeneration||source!==$('preview').currentSrc)return;
 if(await startSmartBackground(health,entry))displaySelectedQuality('smart');
}
