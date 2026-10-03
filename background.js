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
