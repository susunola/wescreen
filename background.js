chrome.commands.onCommand.addListener(command=>chrome.runtime.sendMessage({type:command}).catch(()=>{}));
let highlightGeneration=0;
async function updateRecordingState(message,sender={}) {
  const generation=++highlightGeneration;
  const state=await chrome.storage.session.get(['pointerTargetTabId','recordingOwner']);
  if(generation!==highlightGeneration)return;
  const owner=state.recordingOwner;
  if(!message.active && owner?.tabId && sender.tab?.id && sender.tab.id!==owner.tabId)return;
  const target=message.active ? state.pointerTargetTabId : owner?.targetId ?? state.pointerTargetTabId;
  chrome.action.setBadgeText({text:message.active ? 'REC':''});chrome.action.setBadgeBackgroundColor({color:'#c21f3a'});
  if(message.active && sender.tab?.id)await chrome.storage.session.set({recordingOwner:{tabId:sender.tab.id,targetId:target}});
  else if(chrome.storage.session.remove)await chrome.storage.session.remove('recordingOwner');
  if(generation!==highlightGeneration)return;
  if(target!=null)await chrome.tabs.sendMessage(target,{type:'click-highlights-state',active:Boolean(message.active && message.highlightClicks)}).catch(()=>{});
}
chrome.runtime.onMessage.addListener((message,sender)=>{if(message.type==='recording-state')updateRecordingState(message,sender).catch(()=>{});});
chrome.tabs.onRemoved?.addListener(async tabId=>{const {recordingOwner}=await chrome.storage.session.get('recordingOwner');if(recordingOwner?.tabId===tabId)await updateRecordingState({active:false});});
chrome.runtime.onStartup?.addListener(()=>{chrome.action.setBadgeText({text:''});chrome.storage.session.remove('recordingOwner').catch(()=>{});});

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.type!=='recorder-control')return;
 if(sender.url!==chrome.runtime.getURL('controls.html') || !['stop-recording','pause-recording','mark-important','get-recording-status'].includes(message.action)){respond({error:'Unsupported control request'});return;}
 chrome.storage.session.get('recordingOwner').then(async({recordingOwner})=>{if(!recordingOwner?.tabId)return respond({active:false});try{respond(await chrome.tabs.sendMessage(recordingOwner.tabId,{type:message.action}));}catch{respond({active:false});}}).catch(error=>respond({error:error.message}));return true;
});

chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.type!=='original-tab-stream')return;
 if(sender.url!==chrome.runtime.getURL('recorder.html') || !sender.tab?.id){respond({error:'Unsupported capture request'});return;}
 (async()=>{
  if(!await chrome.permissions.contains({permissions:['tabCapture']}))throw new Error('Tab capture permission is required');
  const {pointerTargetTabId}=await chrome.storage.session.get('pointerTargetTabId');
  if(!pointerTargetTabId || pointerTargetTabId===sender.tab.id)throw new Error('请在原视频标签页点击 WeScreen 再打开录制器 / Open WeScreen from the original video tab');
  const target=await chrome.tabs.get(pointerTargetTabId);
  if(!/^https?:\/\//i.test(target.url || ''))throw new Error('原视频标签页不可访问，请重新点击扩展 / Reopen WeScreen from the video tab');
  const streamId=await chrome.tabCapture.getMediaStreamId({targetTabId:pointerTargetTabId,consumerTabId:sender.tab.id});respond({streamId});
 })().catch(error=>respond({error:error.message}));return true;
});

// Only the explicitly selected source tab is modified; restore it on stop or owner close.
async function restoreQuietAudio(ownerId) {
 const {quietCaptureOwner}=await chrome.storage.session.get('quietCaptureOwner');
 if(!quietCaptureOwner || quietCaptureOwner.ownerId!==ownerId)return;
 await chrome.scripting.executeScript({target:{tabId:quietCaptureOwner.targetId},world:'MAIN',func:()=>{
  const state=window.__wescreenQuietAudio;
  if(!state)return;
  clearInterval(state.timer);state.video.removeEventListener('volumechange',state.enforce);
  state.video.muted=state.muted;state.video.volume=state.volume;delete window.__wescreenQuietAudio;
 }}).catch(()=>{});
 await chrome.storage.session.remove('quietCaptureOwner');
}
chrome.tabs.onRemoved?.addListener(tabId=>restoreQuietAudio(tabId).catch(()=>{}));
chrome.runtime.onMessage.addListener((message,sender,respond)=>{
 if(message.type!=='quiet-tab-audio')return;
 if(sender.url!==chrome.runtime.getURL('recorder.html') || !sender.tab?.id){respond({error:'Unsupported audio request'});return;}
 (async()=>{
  if(!message.active){await restoreQuietAudio(sender.tab.id);return respond({ok:true});}
  if(!await chrome.permissions.contains({permissions:['tabCapture']}))throw new Error('Tab capture permission is required');
  const {pointerTargetTabId,quietCaptureOwner}=await chrome.storage.session.get(['pointerTargetTabId','quietCaptureOwner']);
  if(quietCaptureOwner)throw new Error('已有静音录制，请先停止 / Stop the existing silent recording first');
  if(!pointerTargetTabId || pointerTargetTabId===sender.tab.id)throw new Error('请从视频标签页打开扩展 / Open WeScreen from the video tab');
  const [result]=await chrome.scripting.executeScript({target:{tabId:pointerTargetTabId},world:'MAIN',func:()=>{
   const videos=[...document.querySelectorAll('video')].filter(video=>{const r=video.getBoundingClientRect();return r.width>0 && r.height>0 && getComputedStyle(video).visibility!=='hidden';});
   videos.sort((a,b)=>{const x=a.getBoundingClientRect(),y=b.getBoundingClientRect();return y.width*y.height-x.width*x.height;});
   const video=videos[0];if(!video)return false;
   const state={video,muted:video.muted,volume:video.volume};
   state.enforce=()=>{if(video.muted)video.muted=false;if(video.volume!==1)video.volume=1;};
   state.enforce();video.addEventListener('volumechange',state.enforce);window.__wescreenQuietAudio=state;
   // Navigation discards the document; removing/replacing the player restores its old state.
   state.timer=setInterval(()=>{if(!video.isConnected){clearInterval(state.timer);video.removeEventListener('volumechange',state.enforce);video.muted=state.muted;video.volume=state.volume;delete window.__wescreenQuietAudio;}},1000);
   return true;
  }});
  if(!result?.result)throw new Error('未找到网页视频播放器。请打开视频后重试 / Open the web video player and retry');
  await chrome.storage.session.set({quietCaptureOwner:{ownerId:sender.tab.id,targetId:pointerTargetTabId}});respond({ok:true});
 })().catch(error=>respond({error:error.message}));return true;
});
