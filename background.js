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
