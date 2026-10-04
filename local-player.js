// Local playback uses a File-backed blob URL: no import, upload, or automatic download.
(() => {
  const input=document.createElement('input');input.type='file';input.id='local-video-file';input.accept='video/*,.mp4,.webm,.mov,.m4v,.mkv,.ogv';input.hidden=true;document.body.append(input);
  let opening=false;
  const buttons=[];
  for(const [id,parent]of [['open-local-video',document.querySelector('.header-actions')],['library-open-local',document.querySelector('.library-heading')],['player-open-local',document.querySelector('.player-topbar')]]){
    const button=document.createElement('button');button.id=id;button.type='button';button.className='quiet local-video-button';button.onclick=()=>input.click();parent.append(button);buttons.push(button);
  }
  function notice(message){if(workspaceView==='library')$('library-status').textContent=message;else if(workspaceView==='player'){$('playback-status').textContent=message;$('player-empty-status').textContent=message;}else setNotice(message);}
  function metadata(file){return new Promise((resolve,reject)=>{const video=document.createElement('video'),url=URL.createObjectURL(file);let timer;const finish=(error)=>{clearTimeout(timer);video.removeAttribute('src');video.load();URL.revokeObjectURL(url);error?reject(error):resolve();};video.preload='metadata';video.onloadedmetadata=()=>finish();video.onerror=()=>finish(new Error(E('浏览器无法解码此文件。请使用兼容的 MP4 / WebM，或先转换编码。','This browser cannot decode the file. Use a compatible MP4 / WebM or convert its codec first.')));timer=setTimeout(()=>finish(new Error(E('读取视频超时，请检查文件是否完整或存储设备是否可用。','Video loading timed out. Check the file and storage device.'))),15000);video.src=url;});}
  async function open(file){
    if(!file || opening)return;
    if(recorder || displayStream)throw new Error(E('请先结束录制，再打开本地视频。','Finish recording before opening a local video.'));
    if(!file.size || !(/^video\//.test(file.type) || /\.(mp4|webm|mov|m4v|mkv|ogv)$/i.test(file.name)))throw new Error(E('请选择视频文件。','Choose a video file.'));
    opening=true;buttons.forEach(button=>button.disabled=true);
    try{
      await metadata(file);savePlaybackState();playbackParts=[];playbackPartIndex=0;playbackNextPart=null;playbackBlobCache.clear();partLoadGeneration++;pendingPlaybackPosition=null;
      finalId=null;finalBlob=file;finalSize=file.size;finalName=file.name;finalDuration=0;finalMarkers=[];
      $('review-frames').replaceChildren();$('review-summary').textContent=E('本地文件 · 直接播放，未存入录像库。','Local file · direct playback, not imported into the library.');$('result-warning').hidden=true;
      $('player-empty-status').textContent='';setPreview(file);navigateWorkspace('player');
      $('preview').addEventListener('loadedmetadata',()=>{finalDuration=Number.isFinite($('preview').duration)?$('preview').duration*1000:0;$('preview').play().catch(()=>{});},{once:true});
    }finally{opening=false;buttons.forEach(button=>button.disabled=false);}
  }
  input.onchange=async()=>{const file=input.files[0];input.value='';try{await open(file);}catch(error){notice(error.message);}};
  for(const node of [$('playback-stage'),$('recording-library'),$('player-empty')]){
    node.addEventListener('dragover',event=>{if(![...event.dataTransfer.types].includes('Files'))return;event.preventDefault();event.dataTransfer.dropEffect='copy';node.classList.add('local-drop-target');});
    node.addEventListener('dragleave',event=>{if(!node.contains(event.relatedTarget))node.classList.remove('local-drop-target');});
    node.addEventListener('drop',async event=>{if(!event.dataTransfer.files.length)return;event.preventDefault();node.classList.remove('local-drop-target');try{await open(event.dataTransfer.files[0]);}catch(error){notice(error.message);}});
  }
  const refresh=()=>buttons.forEach(button=>{button.textContent=E('打开本地视频','Open local video');button.title=E('直接播放，不自动导入录像库','Play directly without importing into the library');});window.addEventListener('wescreen-language',refresh);refresh();
})();
