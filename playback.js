// Playback-only rotation. Export rotation remains in the editor.
let playbackRotation=0,playbackZoom=1,playbackPan={x:0,y:0};
function layoutPlaybackRotation() {
 const video=$('preview'),stage=$('playback-stage');
 if(!video.videoWidth || !video.videoHeight || !stage.clientWidth)return;
 const radians=playbackRotation*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
 const boundsWidth=video.videoWidth*c+video.videoHeight*s,boundsHeight=video.videoWidth*s+video.videoHeight*c;
 const maxHeight=document.fullscreenElement===$('playback-shell') ? Math.max(120,innerHeight-360):540;
 const scale=Math.min(stage.clientWidth/boundsWidth,maxHeight/boundsHeight);
 stage.style.height=`${boundsHeight*scale}px`;video.style.width=`${video.videoWidth*scale*playbackZoom}px`;video.style.height=`${video.videoHeight*scale*playbackZoom}px`;
 const maxX=boundsWidth*scale*(playbackZoom-1)/2,maxY=boundsHeight*scale*(playbackZoom-1)/2;playbackPan.x=Math.max(-maxX,Math.min(maxX,playbackPan.x));playbackPan.y=Math.max(-maxY,Math.min(maxY,playbackPan.y));stage.dataset.zoomed=String(playbackZoom>1);
 video.style.transform=`translate(calc(-50% + ${playbackPan.x}px), calc(-50% + ${playbackPan.y}px)) rotate(${playbackRotation}deg)`;
 video.controls=false;$('rotated-playback-controls').hidden=false;
}
function setPlaybackRotation(degrees) {
 if(!Number.isFinite(degrees))return;
 playbackRotation=((degrees%360)+360)%360;$('playback-angle').value=String(playbackRotation);layoutPlaybackRotation();savePlaybackState();
}
function resetPlaybackRotation(){playbackZoom=1;playbackPan={x:0,y:0};$('playback-zoom').value='1';setPlaybackRotation(0);}
$('playback-left').onclick=()=>setPlaybackRotation(playbackRotation-90);
$('playback-right').onclick=()=>setPlaybackRotation(playbackRotation+90);
$('playback-reset').onclick=resetPlaybackRotation;
$('playback-angle').oninput=()=>setPlaybackRotation(Number($('playback-angle').value));
$('preview').addEventListener('loadedmetadata',restorePlaybackState);
new ResizeObserver(layoutPlaybackRotation).observe($('playback-stage'));
document.addEventListener('fullscreenchange',layoutPlaybackRotation);
$('playback-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('playback-shell').requestFullscreen();}catch(error){setNotice(error.message);}};
$('rotated-play').onclick=()=>{const video=$('preview');if(video.paused)video.play().catch(error=>setNotice(error.message));else video.pause();};
$('rotated-mute').onclick=()=>{$('preview').muted=!$('preview').muted;};
$('preview').addEventListener('timeupdate',()=>{const video=$('preview');if(!playbackSeeking && Number.isFinite(video.duration) && video.duration>0)$('rotated-seek').value=String(video.currentTime/video.duration);$('playback-time').textContent=fmt(video.currentTime*1000)+' / '+fmt((Number.isFinite(video.duration) ? video.duration:0)*1000);});
$('rotated-seek').oninput=()=>{const video=$('preview');if(Number.isFinite(video.duration))video.currentTime=Number($('rotated-seek').value)*video.duration;};
let playbackSeeking=false;
$('rotated-seek').addEventListener('pointerdown',()=>{playbackSeeking=true;});
for(const event of ['pointerup','pointercancel','change','blur'])$('rotated-seek').addEventListener(event,()=>{playbackSeeking=false;savePlaybackState();});

let activePlaybackId=null,playbackReady=false,playbackGeneration=0,lastPlaybackSave=0,pendingPlaybackPosition=null;
function savePlaybackState() {
 if(!activePlaybackId || !playbackReady)return;
 const video=$('preview'),id=activePlaybackId;
 const value={time:video.ended ? 0:video.currentTime,rotation:playbackRotation,speed:video.playbackRate,zoom:playbackZoom,brightness:Number($('playback-brightness').value),contrast:Number($('playback-contrast').value),sharpness:Number($('playback-sharpness').value)};
 runTx('meta','readwrite',tx=>tx.objectStore('meta').put(value,`playback:${id}`)).catch(error=>{if(id===activePlaybackId)$('playback-status').textContent=error.message;});
}
function beginPlaybackSource(id) {
 savePlaybackState();activePlaybackId=id;playbackReady=false;playbackGeneration++;lastPlaybackSave=0;
 $('playback-status').textContent='';resetPlaybackTuning();$('preview').playbackRate=1;$('playback-speed').value='1';
 refreshPlaybackVersions().catch(error=>$('playback-status').textContent=error.message);
}
async function restorePlaybackState() {
 const generation=playbackGeneration,id=activePlaybackId,video=$('preview');layoutPlaybackRotation();
 try {
  const state=id ? await readStore('meta',`playback:${id}`):null;
  if(generation!==playbackGeneration)return;
  if(state){setPlaybackRotation(state.rotation || 0);$('playback-speed').value=String(state.speed || 1);video.playbackRate=Number($('playback-speed').value) || 1;playbackZoom=Math.max(1,Math.min(3,state.zoom || 1));$('playback-zoom').value=String(playbackZoom);for(const key of ['brightness','contrast','sharpness'])$('playback-'+key).value=String(state[key] ?? (key==='sharpness' ? 0:1));applyPlaybackTuning();if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(state.time || 0,video.duration-.1));}
  const pending=pendingPlaybackPosition;
  if(pending?.id===id){pendingPlaybackPosition=null;if(Number.isFinite(video.duration))video.currentTime=Math.min(pending.time,Math.max(0,video.duration-.1));if(pending.playing)video.play().catch(error=>$('playback-status').textContent=error.message);}
  playbackReady=true;layoutPlaybackRotation();
 }catch(error){if(generation===playbackGeneration){playbackReady=true;$('playback-status').textContent=error.message;}}
}
$('playback-speed').onchange=()=>{$('preview').playbackRate=Number($('playback-speed').value);savePlaybackState();};
$('preview').addEventListener('timeupdate',()=>{if(Date.now()-lastPlaybackSave>2000){lastPlaybackSave=Date.now();savePlaybackState();}});
for(const event of ['pause','seeked','ended'])$('preview').addEventListener(event,savePlaybackState);
window.addEventListener('pagehide',savePlaybackState);
function applyPlaybackTuning(){
 const sharp=Number($('playback-sharpness').value);
 $('playback-sharp-kernel').setAttribute('kernelMatrix',`0 ${-sharp} 0 ${-sharp} ${1+4*sharp} ${-sharp} 0 ${-sharp} 0`);
 $('preview').style.filter=`brightness(${$('playback-brightness').value}) contrast(${$('playback-contrast').value})${sharp ? ' url(#playback-sharp)':''}`;savePlaybackState();
}
function resetPlaybackTuning(){for(const key of ['brightness','contrast','sharpness'])$('playback-'+key).value=key==='sharpness' ? '0':'1';applyPlaybackTuning();}
for(const key of ['brightness','contrast','sharpness'])$('playback-'+key).oninput=applyPlaybackTuning;
$('playback-tuning-reset').onclick=resetPlaybackTuning;
$('playback-zoom').oninput=()=>{playbackZoom=Number($('playback-zoom').value);layoutPlaybackRotation();savePlaybackState();};
let playbackDrag=null;
$('playback-stage').addEventListener('pointerdown',event=>{if(playbackZoom<=1)return;event.preventDefault();playbackDrag={x:event.clientX,y:event.clientY,pan:{...playbackPan}};$('playback-stage').setPointerCapture(event.pointerId);});
$('playback-stage').addEventListener('pointermove',event=>{if(!playbackDrag)return;playbackPan={x:playbackDrag.pan.x+event.clientX-playbackDrag.x,y:playbackDrag.pan.y+event.clientY-playbackDrag.y};layoutPlaybackRotation();});
for(const event of ['pointerup','pointercancel','lostpointercapture'])$('playback-stage').addEventListener(event,()=>{playbackDrag=null;});
$('playback-stage').ondblclick=()=>{playbackZoom=1;playbackPan={x:0,y:0};$('playback-zoom').value='1';layoutPlaybackRotation();savePlaybackState();};
$('playback-pip').disabled=!document.pictureInPictureEnabled || !$('preview').requestPictureInPicture;
$('playback-pip').onclick=async()=>{try{if(document.pictureInPictureElement)await document.exitPictureInPicture();else{await $('preview').requestPictureInPicture();$('playback-status').textContent=E('画中画按视频原始方向显示，旋转观看请使用全屏。','Picture in picture uses the original video orientation; use fullscreen for rotation.');}}catch(error){$('playback-status').textContent=error.message;}};
async function refreshPlaybackVersions(){
 const id=activePlaybackId,generation=playbackGeneration,entries=(await readStore('recordings')).filter(entry=>!entry.deletedAt),map=new Map(entries.map(entry=>[entry.id,entry]));
 if(id!==activePlaybackId || generation!==playbackGeneration)return;
 const root=entry=>{const seen=new Set();while(entry?.enhancedFrom && map.has(entry.enhancedFrom) && !seen.has(entry.id)){seen.add(entry.id);entry=map.get(entry.enhancedFrom);}return entry?.id;};
 const rootId=root(map.get(id));$('playback-version').replaceChildren();
 for(const entry of entries.filter(entry=>rootId && root(entry)===rootId)) {const option=document.createElement('option');option.value=entry.id;option.textContent=(entry.id===rootId ? E('原版','Original'):E('处理版','Processed')+' · '+(entry.enhancement || ''))+' · '+entry.name;$('playback-version').append(option);}
 $('playback-version').value=id || '';$('playback-version').disabled=$('playback-version').options.length<2;$('playback-enhance').disabled=!map.has(id);
}
$('playback-version').onchange=async()=>{const id=$('playback-version').value,video=$('preview');try{const entry=await readStore('recordings',id);if(!entry || entry.deletedAt)throw new Error(E('此版本已删除。','This version was deleted.'));pendingPlaybackPosition={id,time:video.currentTime,playing:!video.paused};await playRecording(entry);}catch(error){pendingPlaybackPosition=null;$('playback-status').textContent=error.message;}};
$('playback-enhance').onclick=async()=>{try{const entry=await readStore('recordings',activePlaybackId);if(entry)await openEnhancement(entry);}catch(error){$('playback-status').textContent=error.message;}};
$('enhance-panel').addEventListener('close',()=>refreshPlaybackVersions().catch(()=>{}));
document.addEventListener('keydown',event=>{
 if(!$('result').getClientRects().length || document.querySelector('dialog[open]') || event.ctrlKey || event.metaKey || event.altKey || event.target.closest('input,select,textarea,button,[contenteditable=true]'))return;
 const video=$('preview');if(!video.videoWidth)return;
 switch(event.key.toLowerCase()){
  case ' ':$('rotated-play').click();break;
  case 'arrowleft':video.currentTime=Math.max(0,video.currentTime-5);break;
  case 'arrowright':video.currentTime=Math.min(video.duration,video.currentTime+5);break;
  case 'r':setPlaybackRotation(playbackRotation+(event.shiftKey ? -90:90));break;
  case 'f':$('playback-fullscreen').click();break;
  case 'm':video.muted=!video.muted;break;
  default:return;
 }event.preventDefault();
});

function attachPlaybackId(id){if(!id || activePlaybackId===id)return;beginPlaybackSource(id);if($('preview').readyState>0)restorePlaybackState();}

for(const event of ['pointerup','pointercancel'])window.addEventListener(event,()=>{if(playbackSeeking){playbackSeeking=false;savePlaybackState();}});
$('playback-volume').oninput=()=>{$('preview').volume=Number($('playback-volume').value);};
$('preview').addEventListener('volumechange',()=>{$('playback-volume').value=String($('preview').volume);});
