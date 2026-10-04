// Playback remains open until explicitly closed, including during whole-file repair.
let playerUnsavedRecovery=null;
const recoveryButton=document.createElement('button');recoveryButton.className='quiet';recoveryButton.hidden=true;$('player-empty').append(recoveryButton);recoveryButton.onclick=async()=>{if(playerUnsavedRecovery&&await privacy.request())download(playerUnsavedRecovery.blob,playerUnsavedRecovery.name,null);};
let playerClosing=false;
async function exitPlayerPlayback(){
 if(playerClosing)return;playerClosing=true;
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
  navigateWorkspace('player');$('player-empty-status').textContent='';
 }finally{playerClosing=false;}
}
closePlayer.onclick=()=>exitPlayerPlayback();closePlayer.removeAttribute('data-i18n');
function refreshClosePlayer(){recoveryButton.textContent=E('下载未保存录像','Download unsaved recording');closePlayer.textContent=E('退出播放','Close playback');closePlayer.setAttribute('aria-label',closePlayer.textContent);closePlayer.title=E('退出播放','Close playback');}
window.addEventListener('wescreen-language',refreshClosePlayer);refreshClosePlayer();
