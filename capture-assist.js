let preflightResolve=null,preflightAudio=null,preflightTimer=null,reviewGeneration=0;
async function confirmCaptureSource(stream){
 if(!$('preflight-enabled')?.checked)return true;
 const video=$('preflight-video');video.srcObject=stream;video.play().catch(()=>{});const settings=stream.getVideoTracks()[0].getSettings();$('preflight-info').textContent=`${settings.width || '?'}×${settings.height || '?'} · ${stream.getAudioTracks().length ? E('已共享音轨','Audio track shared'):E('未共享音轨','No shared audio')}`;
 if(stream.getAudioTracks().length){preflightAudio=new AudioContext();await preflightAudio.resume();const analyser=preflightAudio.createAnalyser();analyser.fftSize=256;preflightAudio.createMediaStreamSource(stream).connect(analyser);const samples=new Float32Array(256);preflightTimer=setInterval(()=>{analyser.getFloatTimeDomainData(samples);$('preflight-level').value=Math.min(1,Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length)*4);},100);}
 $('preflight-panel').showModal();const track=stream.getVideoTracks()[0],ended=()=>resolvePreflight(false);track.addEventListener('ended',ended,{once:true});const accepted=await new Promise(resolve=>{preflightResolve=resolve;if(track.readyState!=='live')resolvePreflight(false);});track.removeEventListener('ended',ended);clearInterval(preflightTimer);await preflightAudio?.close();preflightAudio=null;video.pause();video.srcObject=null;return accepted;
}
function resolvePreflight(accepted){$('preflight-panel').close();preflightResolve?.(accepted);preflightResolve=null;}
$('preflight-confirm').onclick=()=>resolvePreflight(true);$('preflight-cancel').onclick=()=>resolvePreflight(false);$('preflight-panel').addEventListener('cancel',event=>{event.preventDefault();resolvePreflight(false);});
$('floating-controls').onclick=async()=>{try{await chrome.windows.create({url:chrome.runtime.getURL('controls.html'),type:'popup',width:380,height:260,focused:true});}catch(error){$('recording-alert').hidden=false;$('recording-alert').textContent=error.message;}};
async function renderRecordingReview(entry){
 const generation=++reviewGeneration,list=$('review-frames');list.replaceChildren();$('review-summary').textContent=entry ? `${entry.name} · ${((entry.duration || 0)/1000).toFixed(1)} s · ${entry.width || '?'}×${entry.height || '?'} · ${fmtBytes(entry.size)} · ${E('已存入录像库','Saved to library')}` : E('未成功入库，请立即下载备份。','Not saved to library. Download a backup now.');
 $('review-edit').disabled=!entry;if(!entry)return;const blob=await readStore('videos',entry.id);if(!blob)return;const video=document.createElement('video'),url=URL.createObjectURL(blob);video.muted=true;video.preload='auto';video.src=url;
 const ready=event=>new Promise((resolve,reject)=>{const timeout=setTimeout(()=>{cleanup();reject(new Error(E('验收缩略图读取超时，可直接播放检查。','Thumbnail loading timed out. Play the video to inspect.')));},10000);const cleanup=()=>{clearTimeout(timeout);video.removeEventListener(event,done);video.removeEventListener('error',fail);};const done=()=>{cleanup();resolve();};const fail=()=>{cleanup();reject(new Error(L('errEmpty')));};video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});});
 try{await ready('loadeddata');const duration=Number.isFinite(video.duration) ? video.duration:entry.duration/1000;for(const [label,position] of [[E('开头','Start'),Math.min(.2,duration*.1)],[E('中间','Middle'),duration*.5],[E('结尾','End'),Math.max(0,duration-.2)]]){if(generation!==reviewGeneration)return;const target=Math.max(.001,position);if(Math.abs(video.currentTime-target)>.0001 || video.readyState<2){const seek=ready('seeked');video.currentTime=target;await seek;}const canvas=document.createElement('canvas');canvas.width=240;canvas.height=Math.max(1,Math.round(240*video.videoHeight/video.videoWidth));canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);const figure=document.createElement('figure'),image=document.createElement('img'),caption=document.createElement('figcaption');image.src=canvas.toDataURL('image/jpeg',.7);image.alt=label;caption.textContent=label;figure.append(image,caption);list.append(figure);}
 }finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
}
$('review-edit').onclick=async()=>{try{const entry=await readStore('recordings',finalId);if(entry)await openVideoEditor(entry);}catch(error){$('review-summary').textContent=error.message;}};

let advancingChannel=false;
$('next-channel-video').onclick=async()=>{
 if(activeSegment?.awaitingNext || advancingChannel || rollingSegment || stopRequested || !captureChannelContext?.channelId || !recorder || recorder.state==='inactive')return;
 const button=$('next-channel-video');button.disabled=true;const previous=activeSegment;
 try{
  if(recorder.state==='recording')pause();advancingChannel=true;
  const stopped=new Promise(resolve=>previous.recorder.addEventListener('stop',resolve,{once:true}));await saveSegmentAndContinue();if(activeSegment!==previous)activeSegment.awaitingNext=true;await stopped;await previous.savePromise;clearTimeout(segmentTimer);
  if(stopRequested || !recorder || recorder.state==='inactive')return;
  if(!previous.savedId)throw new Error(L('storageFailed'));
  await completeTelegramRecording(previous);await prepareTelegramChannel();
  activeSegment.awaitingNext=true;activeSegment.channelMetadata={...captureChannelContext};activeSegment.index=1;activeSegment.name=`${sanitized()}.${recordingExtension()}`;activeSegment.start=elapsed();
  await setInProgress({session:activeSegment.session,name:activeSegment.name,mimeType:recordingMime,index:1,...captureChannelContext});
  $('recording-alert').hidden=false;$('recording-alert').textContent=E('上一条已保存。在原共享标签页打开下一条消息，准备好后点击“继续”；仍使用同一共享源。','Previous video saved. Open the next message in the ORIGINAL shared tab, then Resume. The same capture source remains shared.');
  const profile=chosenChannel(),item=profile?.plan?.find(item=>item.id===$('channel-plan-item').value);$('copy-next-message').hidden=!item;$('copy-next-message').dataset.url=item ? telegramLink(item.url):'';
 }catch(error){$('recording-alert').hidden=false;$('recording-alert').textContent=error.message;}finally{advancingChannel=false;button.disabled=Boolean(activeSegment?.awaitingNext);}
};

$('copy-next-message').onclick=async()=>{try{await navigator.clipboard.writeText($('copy-next-message').dataset.url);$('recording-alert').textContent=E('已复制下一条链接。请在原共享 Telegram 标签页地址栏打开，播放后点击继续。','Next link copied. Open it in the original shared Telegram tab, start playback, then Resume.');}catch(error){$('recording-alert').textContent=$('copy-next-message').dataset.url;}};
