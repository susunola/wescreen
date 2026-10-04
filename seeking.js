// A drag previews a target; a release commits once. Clicks start playback immediately.
let seekGesture=null,seekSerial=0,seekKeyboardTimer=null;
const seekRange=$('rotated-seek');
function seekTarget(){return Math.max(0,Math.min(1,Number(seekRange.value)))*playbackTimelineTotal();}
function paintSeekTarget(){const time=seekTarget();$('playback-time').textContent=fmt(time*1000)+' / '+fmt(playbackTimelineTotal()*1000);paintCinemaRanges();}
function setSeekFromPointer(event){const bounds=seekRange.getBoundingClientRect(),inset=7;seekRange.value=String(Math.max(0,Math.min(1,(event.clientX-bounds.left-inset)/Math.max(1,bounds.width-inset*2))));paintSeekTarget();}
seekRange.addEventListener('pointerdown',event=>{
 if(event.button!==0)return;event.preventDefault();seekRange.focus({preventScroll:true});
 const priorPlaying=seekGesture?.playing ?? !$('preview').paused;seekGesture={serial:++seekSerial,pointer:event.pointerId,x:event.clientX,playing:priorPlaying,dragged:false,committed:false};partLoadGeneration++;
 playbackSeeking=true;clearTimeout(seekKeyboardTimer);seekRange.setPointerCapture(event.pointerId);requestPlayerPlayback(false);
 realtimeAI.generation++;realtimeAI.request++;realtimeAI.busy=false;realtimeAI.abort?.abort();realtimeCanvas.hidden=true;revealFullscreenControls();
 setSeekFromPointer(event);
});
seekRange.addEventListener('pointermove',event=>{if(seekGesture?.pointer===event.pointerId){if(Math.abs(event.clientX-seekGesture.x)>4)seekGesture.dragged=true;setSeekFromPointer(event);}});
seekRange.oninput=()=>{playbackSeeking=true;paintSeekTarget();if(!seekGesture){clearTimeout(seekKeyboardTimer);seekKeyboardTimer=setTimeout(()=>commitSeekTarget(null),90);}};
async function commitSeekTarget(event){
 const gesture=seekGesture;if(gesture?.committed)return;if(event?.pointerId!==undefined&&gesture?.pointer!==event.pointerId)return;
 if(gesture)gesture.committed=true;clearTimeout(seekKeyboardTimer);
 const started=performance.now();const serial=gesture?.serial ?? ++seekSerial,time=seekTarget(),playing=gesture?(gesture.dragged?gesture.playing:true):!$('preview').paused;
 cinemaThumbnail.hidden=true;
 try{
  await seekRecordingTimeline(time,playing);
  if(serial!==seekSerial)return;
  // play() waits for the requested frame itself; do not add an artificial seek debounce here.
  if(playing){if(pendingPlaybackPosition)pendingPlaybackPosition.playing=true;else await requestPlayerPlayback();}
  savePlaybackState();
  const report=()=>{if(serial!==seekSerial)return;const v=$('preview');if(!v.seeking && Math.abs(playbackTimelineTime()-time)<.2)seekRange.dataset.responseMs=String(Math.round(performance.now()-started));else if(v.requestVideoFrameCallback && performance.now()-started<8000)v.requestVideoFrameCallback(report);};
  if($('preview').requestVideoFrameCallback)$('preview').requestVideoFrameCallback(report);else $('preview').addEventListener('seeked',report,{once:true});
 }catch(error){if(serial===seekSerial)$('playback-status').textContent=error.message;}
 finally{if(serial===seekSerial){seekGesture=null;playbackSeeking=false;revealFullscreenControls();}}
}
for(const event of ['pointerup','pointercancel'])window.addEventListener(event,commitSeekTarget);
seekRange.addEventListener('blur',()=>{if(playbackSeeking&&!seekGesture)commitSeekTarget(null);});

// One thumbnail decoder and a bounded cache; never recreate a large Blob URL on every move.
const thumbFrames=new Map(),thumbUrls=new Map();let thumbTarget=null,thumbWorking=false,thumbLast=0,thumbTimer=null,thumbEpoch=0;
function boundedCache(map,key,value,max){map.delete(key);map.set(key,value);while(map.size>max){const oldest=map.keys().next().value;if(map===thumbUrls)URL.revokeObjectURL(map.get(oldest));map.delete(oldest);}}
function locateThumbnail(time){let index=0,offset=0;while(index<playbackParts.length-1&&time>=offset+(playbackParts[index].duration||0)/1000){offset+=(playbackParts[index].duration||0)/1000;index++;}return {entry:playbackParts[index],time:Math.max(.001,time-offset),index};}
async function decodeThumbnail(){
 if(thumbWorking||thumbTarget===null)return;thumbWorking=true;const target=thumbTarget,epoch=thumbEpoch;thumbTarget=null;
 try{
  const source=locateThumbnail(target),key=(source.entry?.id||activePlaybackId)+':'+Math.floor(source.time*2);
  const cached=thumbFrames.get(key);if(cached){const bitmap=await createImageBitmap(cached);cinemaCanvas.getContext('2d').drawImage(bitmap,0,0);bitmap.close();return;}
  let url=source.index===playbackPartIndex?$('preview').currentSrc:thumbUrls.get(source.entry.id);
  if(!url){const blob=await readStore('videos',source.entry.id);if(epoch!==thumbEpoch||!blob)return;url=URL.createObjectURL(blob);boundedCache(thumbUrls,source.entry.id,url,2);}
  if(!url)return;
  if(cinemaScrubVideo.src!==url){await thumbnailEvent('loadedmetadata',()=>{cinemaScrubVideo.src=url;cinemaScrubVideo.load();});}
  if(epoch!==thumbEpoch)return;
  const time=Math.min(source.time,Math.max(.001,cinemaScrubVideo.duration-.01));cinemaHoverTime=time;
  if(Math.abs(cinemaScrubVideo.currentTime-time)>.02||cinemaScrubVideo.readyState<2)await thumbnailEvent('seeked',()=>cinemaScrubVideo.currentTime=time);
  if(epoch!==thumbEpoch)return;
  cinemaCanvas.getContext('2d').drawImage(cinemaScrubVideo,0,0,160,90);
  const blob=await new Promise(resolve=>cinemaCanvas.toBlob(resolve,'image/jpeg',.7));if(blob)boundedCache(thumbFrames,key,blob,80);
 }catch{/* A missing thumbnail must never block playback. */}
 finally{thumbWorking=false;thumbLast=performance.now();if(thumbTarget!==null){clearTimeout(thumbTimer);thumbTimer=setTimeout(()=>{thumbTimer=null;decodeThumbnail();},110);}}
}
function thumbnailEvent(name,action){return new Promise((resolve,reject)=>{const done=()=>{cleanup();resolve();},fail=()=>{cleanup();reject(new Error('Thumbnail unavailable'));},timer=setTimeout(fail,2500),cleanup=()=>{clearTimeout(timer);cinemaScrubVideo.removeEventListener(name,done);cinemaScrubVideo.removeEventListener('error',fail);};cinemaScrubVideo.addEventListener(name,done,{once:true});cinemaScrubVideo.addEventListener('error',fail,{once:true});action();});}
seekRange.addEventListener('pointermove',event=>{const r=seekRange.getBoundingClientRect(),time=Math.max(0,Math.min(1,(event.clientX-r.left)/r.width))*playbackTimelineTotal();thumbTarget=time;cinemaTime.textContent=fmt(time*1000);cinemaThumbnail.hidden=false;cinemaThumbnail.style.left=Math.max(84,Math.min(r.width-84,event.clientX-r.left))+'px';if(!thumbWorking&&!thumbTimer)thumbTimer=setTimeout(()=>{thumbTimer=null;decodeThumbnail();},Math.max(0,110-(performance.now()-thumbLast)));});
seekRange.addEventListener('pointerleave',()=>{thumbEpoch++;thumbTarget=null;clearTimeout(thumbTimer);thumbTimer=null;cinemaThumbnail.hidden=true;});
window.addEventListener('pagehide',()=>{clearTimeout(thumbTimer);clearTimeout(seekKeyboardTimer);thumbEpoch++;for(const url of thumbUrls.values())URL.revokeObjectURL(url);});
