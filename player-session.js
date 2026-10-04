// Five minutes without intentional interaction closes private playback, including PiP.
let playerUnsavedRecovery=null;
const recoveryButton=document.createElement('button');recoveryButton.className='quiet';recoveryButton.hidden=true;$('player-empty').append(recoveryButton);recoveryButton.onclick=async()=>{if(playerUnsavedRecovery&&await privacy.request())download(playerUnsavedRecovery.blob,playerUnsavedRecovery.name,null);};
const playerIdle={last:performance.now(),limit:5*60*1000,closing:false,active:false};
function resetPlayerIdle(){playerIdle.last=performance.now();}
async function exitPlayerPlayback(automatic=false){
 if(playerIdle.closing)return;playerIdle.closing=true;
 try{
  if(!finalId&&finalBlob instanceof Blob&&!(finalBlob instanceof File))playerUnsavedRecovery={blob:finalBlob,name:finalName};
  recoveryButton.hidden=!playerUnsavedRecovery;
  savePlaybackState();playbackTransportIntent++;playbackGeneration++;partLoadGeneration++;
  $('preview').pause();stopSmartBackground();stopRealtimeAI();
  if(document.pictureInPictureElement)await document.exitPictureInPicture().catch(()=>{});
  if(document.fullscreenElement)await document.exitFullscreen().catch(()=>{});
  setTheatreMode(false);clearPreview();activePlaybackId=null;playbackReady=false;pendingPlaybackPosition=null;
  playbackParts=[];playbackPartIndex=0;playbackNextPart=null;playbackBlobCache.clear();
  finalBlob=null;finalId=null;finalSize=0;finalDuration=0;finalName='';finalMarkers=[];
  instantEnhancement=null;nativeSmartHDR=false;displaySelectedQuality('original');
  for(const menu of cinemaMenus)menu.open=false;
  navigateWorkspace('player');$('player-empty-status').textContent=automatic?E('已因 5 分钟无操作退出播放。录像未删除。','Playback closed after 5 minutes without interaction. Recordings are retained.'):'';
 }finally{playerIdle.closing=false;playerIdle.active=false;resetPlayerIdle();}
}
function checkPlayerIdle(now=performance.now()){
 if((workspaceView==='player'||document.pictureInPictureElement)&&$('preview').hasAttribute('src')&&now-playerIdle.last>=playerIdle.limit)return exitPlayerPlayback(true);
}
for(const event of ['pointerdown','keydown','wheel','input'])document.addEventListener(event,resetPlayerIdle,{capture:true,passive:true});
$('preview').addEventListener('loadedmetadata',()=>{if(!playerIdle.active)resetPlayerIdle();playerIdle.active=true;});
setInterval(checkPlayerIdle,1000);
closePlayer.onclick=()=>exitPlayerPlayback();closePlayer.removeAttribute('data-i18n');
function refreshClosePlayer(){recoveryButton.textContent=E('下载未保存录像','Download unsaved recording');closePlayer.textContent=E('退出播放','Close playback');closePlayer.setAttribute('aria-label',closePlayer.textContent);closePlayer.title=E('退出播放 · 5 分钟无操作自动退出','Close playback · Auto close after 5 minutes without interaction');}
window.addEventListener('wescreen-language',refreshClosePlayer);refreshClosePlayer();
