// Playback-only rotation. Export rotation remains in the editor.
let playbackRotation=0,playbackZoom=1,playbackPan={x:0,y:0};
function layoutPlaybackRotation() {
 const video=$('preview'),stage=$('playback-stage');
 if(!video.videoWidth || !video.videoHeight || !stage.clientWidth)return;
 const radians=playbackRotation*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
 const boundsWidth=video.videoWidth*c+video.videoHeight*s,boundsHeight=video.videoWidth*s+video.videoHeight*c;
 const maxHeight=document.fullscreenElement===$('playback-shell') ? Math.max(120,innerHeight):540;
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
 const value={instantPreset:instantEnhancement,time:video.ended ? 0:video.currentTime,rotation:playbackRotation,speed:video.playbackRate,zoom:playbackZoom,brightness:Number($('playback-brightness').value),contrast:Number($('playback-contrast').value),sharpness:Number($('playback-sharpness').value)};
 runTx('meta','readwrite',tx=>tx.objectStore('meta').put(value,`playback:${id}`)).catch(error=>{if(id===activePlaybackId)$('playback-status').textContent=error.message;});
}
function beginPlaybackSource(id) {
 instantEnhancement=null;updateInstantEnhancementButton();savePlaybackState();activePlaybackId=id;playbackReady=false;playbackGeneration++;lastPlaybackSave=0;
 $('playback-status').textContent='';$('playback-name').textContent=finalName || E('视频播放','Video playback');resetPlaybackTuning();$('preview').playbackRate=1;$('playback-speed').value='1';
 refreshPlaybackVersions().catch(error=>$('playback-status').textContent=error.message);
}
async function restorePlaybackState() {
 const generation=playbackGeneration,id=activePlaybackId,video=$('preview');layoutPlaybackRotation();
 try {
  const state=id ? await readStore('meta',`playback:${id}`):null;
  if(generation!==playbackGeneration)return;
  if(state){instantEnhancement=state.instantPreset || null;updateInstantEnhancementButton();setPlaybackRotation(state.rotation || 0);$('playback-speed').value=String(state.speed || 1);video.playbackRate=Number($('playback-speed').value) || 1;playbackZoom=Math.max(1,Math.min(3,state.zoom || 1));$('playback-zoom').value=String(playbackZoom);for(const key of ['brightness','contrast','sharpness'])$('playback-'+key).value=String(state[key] ?? (key==='sharpness' ? 0:1));applyPlaybackTuning();if(Number.isFinite(video.duration))video.currentTime=Math.max(0,Math.min(state.time || 0,video.duration-.1));}
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

let instantEnhancement=null,playbackAIBusy=false;
function updateInstantEnhancementButton(){const button=$('playback-instant');button.setAttribute('aria-pressed',String(!!instantEnhancement));button.textContent=E('即时增强','Instant enhancement');}
$('playback-instant').onclick=()=>{
 if(instantEnhancement){for(const [key,value] of Object.entries(instantEnhancement))$('playback-'+key).value=value;instantEnhancement=null;}
 else{instantEnhancement=Object.fromEntries(['brightness','contrast','sharpness'].map(key=>[key,$('playback-'+key).value]));$('playback-brightness').value='1.05';$('playback-contrast').value='1.1';$('playback-sharpness').value='0.2';}
 applyPlaybackTuning();updateInstantEnhancementButton();$('playback-status').textContent=instantEnhancement ? E('即时增强已开启，仅影响观看，原文件保留。','Instant enhancement enabled for viewing; original file preserved.'):E('已恢复开启增强前的画面设置。','Previous picture settings restored.');
};
async function completePlaybackAI(task,savedId){
 if(!task.playbackAI || activePlaybackId!==task.sourceId || !$('result').getClientRects().length)return;
 const entry=await readStore('recordings',savedId);if(!entry)return;
 const video=$('preview');pendingPlaybackPosition={id:savedId,time:video.currentTime,playing:!video.paused};await playRecording(entry);
 $('playback-status').textContent=E('AI 修复完成，已切换增强版；原视频保留。','AI repair complete. Switched to the enhanced version; original preserved.');
}
$('playback-ai').onclick=async()=>{
 if(playbackAIBusy)return;playbackAIBusy=true;$('playback-ai').disabled=true;
 const sourceId=activePlaybackId;let task;
 try{
  const source=await readStore('recordings',sourceId);if(!source)throw new Error(E('请先打开录像。','Open a recording first.'));
  $('playback-status').textContent=E('正在连接本机 AI…','Connecting to local AI…');
  if(!helperHealth)await connectHelper();
  if(!helperHealth){$('playback-status').textContent=E('AI 修复需要本机处理程序，正在打开连接设置。','AI repair requires the local helper. Opening connection settings.');await openEnhancement(source);return;}
  const mode=helperHealth.ai ? 'ai':helperHealth.strong ? 'strong':null;
  if(!mode)throw new Error(E('未安装 AI 模型。请在关于页安装增强包。','No AI model installed. Install the enhancement package from About.'));
  task=await submitProcessing(source,{mode,preview:false,start:0,playbackAI:true});
  while(true){
   const info=await(await enhancementRequest(`/jobs/${task.id}`)).json();
   if(activePlaybackId===sourceId)$('playback-status').textContent=E('AI 后台修复中，可继续播放 · ','AI repair runs in the background; keep watching · ')+Math.round((info.progress || 0)*100)+'%';
   if(info.state==='error' || info.state==='cancelled')throw new Error(info.error || L('jobCancelled'));
   if(info.state==='done'){const id=await saveTaskResult({...task,...info});await completePlaybackAI(task,id);break;}
   await new Promise(resolve=>setTimeout(resolve,1500));
  }
 }catch(error){if(activePlaybackId===sourceId)$('playback-status').textContent=E('AI 修复未完成：','AI repair did not finish: ')+error.message+(task ? E('；可在视频处理页查看或导出结果。','; inspect or export the result from Processing.'):'');}
 finally{playbackAIBusy=false;$('playback-ai').disabled=false;renderEnhancementTasks().catch(()=>{});}
};

function updatePlayerTransport(){const video=$('preview');$('rotated-play').querySelector('svg').innerHTML=video.paused ? '<path d="m8 5 10 7-10 7Z"/>':'<path d="M8 5v14M16 5v14"/>';$('rotated-play').title=video.paused ? E('播放（空格）','Play (Space)'):E('暂停（空格）','Pause (Space)');$('rotated-play').setAttribute('aria-label',$('rotated-play').title);$('rotated-mute').dataset.muted=String(video.muted);}
for(const event of ['play','pause','volumechange'])$('preview').addEventListener(event,updatePlayerTransport);
$('preview').addEventListener('loadedmetadata',()=>{$('playback-time').textContent=fmt($('preview').currentTime*1000)+' / '+fmt((Number.isFinite($('preview').duration) ? $('preview').duration:0)*1000);updatePlayerTransport();});

let fullscreenControlsTimer;
function revealFullscreenControls(){
 const shell=$('playback-shell');shell.classList.remove('controls-hidden');clearTimeout(fullscreenControlsTimer);
 if(!$('preview').paused)fullscreenControlsTimer=setTimeout(()=>{if(!shell.querySelector('details[open]'))shell.classList.add('controls-hidden');},2200);
}
$('playback-shell').addEventListener('pointermove',revealFullscreenControls);
$('playback-shell').addEventListener('pointerdown',revealFullscreenControls);
$('preview').addEventListener('play',revealFullscreenControls);
$('preview').addEventListener('pause',revealFullscreenControls);
document.addEventListener('fullscreenchange',revealFullscreenControls);

// Cinema controls keep all viewing tools inside the player, including fullscreen.
const cinemaTransport=$('rotated-playback-controls');
const qualityMenu=document.createElement('details');qualityMenu.id='playback-quality-menu';qualityMenu.className='cinema-menu';
const qualitySummary=document.createElement('summary');qualitySummary.textContent=E('画质','Quality');qualitySummary.dataset.i18n='labelQuality';qualityMenu.append(qualitySummary);
const qualityPanel=document.createElement('div');qualityPanel.className='cinema-popover';qualityPanel.setAttribute('role','group');qualityPanel.setAttribute('aria-label',E('画质设置','Quality settings'));
const originalPicture=document.createElement('button');originalPicture.type='button';originalPicture.textContent=E('原画','Original');originalPicture.dataset.i18n='originalPicture';originalPicture.onclick=()=>{if(instantEnhancement)$('playback-instant').click();$('playback-tuning-reset').click();};$('playback-instant').dataset.i18n='instantViewing';qualityPanel.append(originalPicture,$('playback-instant'),$('playback-ai'),$('playback-enhance'));qualityMenu.append(qualityPanel);cinemaTransport.insertBefore(qualityMenu,$('playback-pip'));
const rotationMenu=$('playback-rotation-menu');rotationMenu.classList.add('cinema-menu');const rotationSummary=rotationMenu.querySelector(':scope > summary');rotationSummary.removeAttribute('data-i18n');rotationSummary.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7V3l-4 4a8 8 0 1 0 4 10M20 3h-5"/></svg><span class="sr-only" data-i18n="playerView">旋转与视图</span>';rotationSummary.title=E('旋转与视图','Rotation & view');rotationMenu.querySelector('.playback-toolbar').classList.add('cinema-popover');rotationMenu.querySelector('.playback-toolbar').append(document.querySelector('.playback-tuning'));cinemaTransport.insertBefore(rotationMenu,$('playback-pip'));
const cinemaMenus=[qualityMenu,rotationMenu];for(const menu of cinemaMenus){menu.querySelector(':scope > summary').addEventListener('click',()=>{cinemaMenus.filter(other=>other!==menu).forEach(other=>other.open=false);revealFullscreenControls();});menu.addEventListener('toggle',revealFullscreenControls);}
document.addEventListener('pointerdown',event=>{for(const menu of cinemaMenus)if(!menu.contains(event.target))menu.open=false;});
document.addEventListener('keydown',event=>{if(event.key==='Escape')cinemaMenus.forEach(menu=>menu.open=false);});
for(const [id,delta] of [['playback-back',-10],['playback-forward',10]]){const button=document.createElement('button');button.id=id;button.type='button';button.title=E(delta<0?'后退 10 秒':'快进 10 秒',delta<0?'Back 10 seconds':'Forward 10 seconds');button.setAttribute('aria-label',button.title);button.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${delta<0?'M6 5 2 9l4 4M2 9h11a8 8 0 1 1-7 12':'M18 5l4 4-4 4m4-4H11a8 8 0 1 0 7 12'}"/><text x="8" y="17" font-size="8" stroke="none" fill="currentColor">10</text></svg>`;button.onclick=()=>{const v=$('preview');v.currentTime=Math.max(0,Math.min(Number.isFinite(v.duration)?v.duration:Infinity,v.currentTime+delta));};cinemaTransport.insertBefore(button,$('playback-time'));}
$('playback-shell').addEventListener('pointerleave',()=>{if(!$('preview').paused && !cinemaMenus.some(menu=>menu.open))$('playback-shell').classList.add('controls-hidden');});

const cinemaThumbnail=document.createElement('div');cinemaThumbnail.className='cinema-thumbnail';cinemaThumbnail.hidden=true;
const cinemaCanvas=document.createElement('canvas');cinemaCanvas.width=160;cinemaCanvas.height=90;const cinemaTime=document.createElement('span');cinemaThumbnail.append(cinemaCanvas,cinemaTime);document.querySelector('.player-timeline').append(cinemaThumbnail);
const cinemaScrubVideo=document.createElement('video');cinemaScrubVideo.muted=true;cinemaScrubVideo.preload='metadata';let cinemaHoverTime=0;
cinemaScrubVideo.addEventListener('seeked',()=>{try{cinemaCanvas.getContext('2d').drawImage(cinemaScrubVideo,0,0,160,90);}catch{}});
function seekCinemaThumbnail(){if(cinemaScrubVideo.readyState>=1 && !cinemaScrubVideo.seeking)cinemaScrubVideo.currentTime=cinemaHoverTime;}
cinemaScrubVideo.addEventListener('loadedmetadata',seekCinemaThumbnail);
$('rotated-seek').addEventListener('pointermove',event=>{const v=$('preview');if(!Number.isFinite(v.duration)||v.duration<=0)return;const bounds=event.currentTarget.getBoundingClientRect(),fraction=Math.max(0,Math.min(1,(event.clientX-bounds.left)/bounds.width));cinemaHoverTime=Math.min(v.duration-.01,fraction*v.duration);cinemaTime.textContent=fmt(cinemaHoverTime*1000);cinemaThumbnail.hidden=false;cinemaThumbnail.style.left=`${Math.max(84,Math.min(bounds.width-84,event.clientX-bounds.left))}px`;if(cinemaScrubVideo.src!==v.currentSrc){cinemaScrubVideo.src=v.currentSrc;cinemaScrubVideo.load();}else seekCinemaThumbnail();});
$('rotated-seek').addEventListener('pointerleave',()=>cinemaThumbnail.hidden=true);

$('preview').addEventListener('loadedmetadata',()=>{cinemaScrubVideo.removeAttribute('src');cinemaScrubVideo.load();cinemaThumbnail.hidden=true;});
const cinemaFooter=document.createElement('div');cinemaFooter.className='cinema-footer';const cinemaMetadata=document.createElement('span');cinemaMetadata.textContent=E('本地视频 · 原文件保留','Local video · Original preserved');cinemaFooter.append(cinemaMetadata,$('download'));$('playback-shell').append(cinemaFooter);
$('preview').addEventListener('loadedmetadata',()=>{const v=$('preview');cinemaMetadata.textContent=`${v.videoWidth} × ${v.videoHeight} · ${E('本地视频','Local video')}`;});
