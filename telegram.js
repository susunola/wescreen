// Channel profiles and a user-managed recording plan; capture still uses the browser picker.
let telegramProfiles=[], captureChannelContext=null, channelRenderGeneration=0;
function safePart(value){return String(value||'').trim().replace(/[\\/:*?"<>|]/g,'-').replace(/^\.+$/,'').slice(0,80);}
function telegramLink(value){
  if(!value?.trim())return '';
  const url=new URL(/^https?:\/\//i.test(value.trim())?value.trim():'https://'+value.trim());
  if(!['t.me','telegram.me','web.telegram.org'].includes(url.hostname) || !['https:','http:'].includes(url.protocol))throw new Error(L('telegramLinkInvalid'));
  url.protocol='https:';return url.href;
}
function telegramMessage(value){
 const url=new URL(telegramLink(value)),parts=url.pathname.split('/').filter(Boolean);
 const privateChannel=parts[0]==='c',channel=parts[privateChannel?1:0],message=parts.at(-1);
 if((privateChannel&&!/^\d+$/.test(channel||''))||!['t.me','telegram.me'].includes(url.hostname)||!channel||!/^\d+$/.test(message)||parts.length<(privateChannel?3:2)||(!privateChannel&&!/^[a-zA-Z][a-zA-Z0-9_]{3,}$/.test(channel)))throw new Error(E('请粘贴视频消息链接，例如 t.me/频道/123 或 t.me/c/频道编号/123。','Paste a video message link: t.me/channel/123 or t.me/c/channel-id/123.'));
 const key=(privateChannel?'private:':'public:')+(privateChannel?channel:channel.toLowerCase());
 return {key,messageId:message,channel,privateChannel,url:'https://t.me/'+parts.join('/')+url.search,channelUrl:'https://t.me/'+(privateChannel?'c/':'')+channel,name:privateChannel?E('私有频道 ','Private channel ')+channel:channel};
}
function telegramProfileKey(profile){
 if(profile.channelKey)return profile.channelKey;
 try{const p=new URL(profile.url).pathname.split('/').filter(Boolean);return p[0]==='c'?'private:'+p[1]:p[0]?'public:'+p[0].toLowerCase():null;}catch{return null;}
}
function relativeFolder(value){return String(value||'').split(/[\\/]/).map(safePart).filter(Boolean).join('/').slice(0,180);}
async function refreshTelegramProfiles(){telegramProfiles=(await readStore('meta')).filter(value=>value?.channelProfile);return telegramProfiles;}
function chosenChannel(){return telegramProfiles.find(profile=>profile.id===$('channel-select').value);}
function updateTelegramFilename(){
  $('channel-number-summary').textContent=E('自动编号 ','Next number ')+String(Math.max(1,Number($('channel-episode').value)||1)).padStart(3,'0')+E(' · 保存到本机录像库',' · Saved in the local library');
  $('channel-name-field').hidden=!$('channel-name-field').dataset.editing;$('channel-save').hidden=!$('channel-name-field').dataset.editing;
  if($('capture-mode').value!=='telegram')return;
  const name=safePart($('channel-name').value)||'Telegram',number=Math.max(1,Number($('channel-episode').value)||1),title=safePart($('channel-video-title').value);
  $('filename').value=`${name}-${String(number).padStart(3,'0')}${title ? '-'+title:''}`.slice(0,120);
}
function selectNextChannelVideo(){
  const select=$('channel-plan-item');if(!select.value){const next=[...select.options].find(option=>option.value && !option.textContent.startsWith('✓ ') && !option.textContent.startsWith('↷ '));select.value=next?.value || '';}
  const item=chosenChannel()?.plan?.find(item=>item.id===select.value);if(item && item.status!=='skipped'){$('channel-video-title').value=item.title;$('channel-message-url').value=item.url;}updateTelegramFilename();
}
async function renderChannelPlan(){
  const profile=chosenChannel(),select=$('channel-plan-item'),selected=select.value;select.replaceChildren();
  const blank=document.createElement('option');blank.value='';blank.textContent=L('manualVideo');select.append(blank);
  const records=await readStore('recordings');
  for(const item of profile?.plan || []){const saved=records.some(entry=>entry.channelTaskId===item.id),option=document.createElement('option');option.value=item.id;option.textContent=(saved ? '✓ ':item.status==='skipped' ? '↷ ':'')+item.title;select.append(option);}
  if([...select.options].some(option=>option.value===selected))select.value=selected;
  $('channel-plan-choice').hidden=!profile?.plan?.length;
  if(!$('channel-plan-dialog').open)$('channel-plan').value=(profile?.plan || []).map(item=>`${item.title} | ${item.url}`).join('\n');
}
async function loadTelegramProfiles(selectedId){
  await refreshTelegramProfiles();const select=$('channel-select');select.replaceChildren();
  const blank=document.createElement('option');blank.value='';blank.textContent=L('newChannel');select.append(blank);
  for(const profile of telegramProfiles.sort((a,b)=>a.name.localeCompare(b.name))){const option=document.createElement('option');option.value=profile.id;option.textContent=profile.name;select.append(option);}
  select.value=selectedId || '';
  await renderChannelPlan();
}
function fillChannel(profile){
  $('channel-name').value=profile?.name || '';$('channel-url').value=profile?.url || '';$('channel-episode').value=String(profile?.nextEpisode || 1);$('channel-folder').value=profile?.exportFolder || '';
  $('channel-video-title').value='';$('channel-message-url').value='';updateTelegramFilename();
}
async function saveTelegramProfile(){
  const message=$('channel-message-url').value.trim()?telegramMessage($('channel-message-url').value):null;
  await refreshTelegramProfiles();
  const selected=chosenChannel(),existing=message?telegramProfiles.find(p=>telegramProfileKey(p)===message.key):selected;
  const same=existing?.id===selected?.id;
  const name=(existing?.name || (same || !selected || !message ? $('channel-name').value.trim():'' ) || message?.name || $('channel-name').value.trim() || E('Telegram 视频','Telegram videos')).slice(0,80);
  const renamed=$('channel-name-field').dataset.editing && same ? $('channel-name').value.trim():'';
  const id=existing?.id || crypto.randomUUID();
  const profile={...existing,id,channelProfile:true,name:renamed || name,channelKey:message?.key || existing?.channelKey,url:message?.channelUrl || telegramLink($('channel-url').value),nextEpisode:Math.max(1,Number(same || !selected || !message ? $('channel-episode').value:existing?.nextEpisode)||1),exportFolder:existing?.exportFolder || relativeFolder(same || !message ? $('channel-folder').value:'') || `WeScreen/Telegram/${safePart(renamed || name)}`,plan:existing?.plan || []};
  await runTx('meta','readwrite',tx=>{const store=tx.objectStore('meta'),request=store.get(`channel:${id}`);request.onsuccess=()=>{if(request.result){profile.plan=request.result.plan || profile.plan;profile.nextEpisode=Math.max(profile.nextEpisode,request.result.nextEpisode || 1);}store.put(profile,`channel:${id}`);};});await loadTelegramProfiles(id);
  $('channel-name').value=profile.name;$('channel-url').value=profile.url;$('channel-episode').value=String(profile.nextEpisode);$('channel-folder').value=profile.exportFolder;$('channel-config').open=false;await chrome.storage.local.set({selectedTelegramChannel:id});persist();return profile;
}
async function prepareTelegramChannel(){
  captureChannelContext=null;if($('capture-mode').value!=='telegram')return;
  if(!$('channel-message-url').value.trim()&&!chosenChannel())throw new Error(E('请先粘贴视频消息链接。','Paste a video message link first.'));
  const profile=await saveTelegramProfile();updateTelegramFilename();
  const taskId=$('channel-plan-item').value;const existing=(await readStore('recordings')).filter(entry=>entry.channelTaskId && entry.channelTaskId===taskId && !entry.deletedAt);if(existing.length && !confirm(E('这条消息已有录像，仍要录制新的版本吗？','This message already has recordings. Record another version?')))throw new Error(E('已取消重录。','Rerecord cancelled.'));
  captureChannelContext={channelKey:telegramProfileKey(profile),channelId:profile.id,channelName:profile.name,channelUrl:profile.url,course:profile.name,episode:profile.nextEpisode,messageId:$('channel-message-url').value.trim()?telegramMessage($('channel-message-url').value).messageId:null,sourceUrl:telegramLink($('channel-message-url').value),sourceTitle:$('channel-video-title').value.trim(),channelTaskId:$('channel-plan-item').value || null,exportFolder:profile.exportFolder};
  captureChannelContext.captureDiagnostics={audioObserved:false,audioSamples:0,bufferPauses:0,maxWriteAge:0};
  if(captureChannelContext.messageId)captureChannelContext.sourceMessageKey=captureChannelContext.channelKey+':'+captureChannelContext.messageId;
}
async function completeTelegramRecording(state){
  const info=state?.channelMetadata;if(!info?.channelId)return;
  await runTx('meta','readwrite',tx=>{const store=tx.objectStore('meta'),request=store.get(`channel:${info.channelId}`);request.onsuccess=()=>{if(request.result)store.put({...request.result,nextEpisode:Math.max(request.result.nextEpisode || 1,info.episode+1)},`channel:${info.channelId}`);};});
  await refreshTelegramProfiles();
  if($('channel-select').value===info.channelId){$('channel-episode').value=String(chosenChannel().nextEpisode);$('channel-video-title').value='';$('channel-message-url').value='';await renderChannelPlan();const records=await readStore('recordings'),next=chosenChannel().plan.find(item=>item.status!=='skipped' && !records.some(entry=>entry.channelTaskId===item.id));$('channel-plan-item').value=next?.id || '';if(next){$('channel-video-title').value=next.title;$('channel-message-url').value=next.url;}updateTelegramFilename();persist();}
}
async function initTelegramChannels(){
  const openPlan=()=>{$('channel-plan-dialog').showModal();$('channel-plan').focus();};
  $('channel-add-video').onclick=$('channel-edit-plan').onclick=openPlan;
  $('channel-plan-close').onclick=()=>$('channel-plan-dialog').close();
  $('channel-new').onclick=async()=>{$('channel-select').value='';$('channel-select').dispatchEvent(new Event('change'));$('channel-name-field').hidden=true;$('channel-message-url').focus();};
  $('channel-manage').onclick=()=>{$('channel-name-field').dataset.editing='true';$('channel-name-field').hidden=false;$('channel-save').hidden=false;$('channel-config').open=true;$('channel-name').focus();};
  $('channel-clear-completed').onclick=async()=>{try{const profile=chosenChannel();if(!profile)return;const records=await readStore('recordings'),completed=new Set(records.map(record=>record.channelTaskId));const plan=profile.plan.filter(item=>!completed.has(item.id));if(plan.length===profile.plan.length)return;if(!confirm(E('从清单移除已完成项？已保存的录像保留。','Remove completed plan items? Saved recordings are preserved.')))return;await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...profile,plan},'channel:'+profile.id));await refreshTelegramProfiles();await renderChannelPlan();await renderChannelWorkbench();}catch(error){$('channel-status').textContent=error.message;}};
  const {selectedTelegramChannel}=await chrome.storage.local.get('selectedTelegramChannel');await loadTelegramProfiles(selectedTelegramChannel);if(chosenChannel()){fillChannel(chosenChannel());selectNextChannelVideo();$('channel-config').open=false;}
  $('telegram-channel').hidden=$('capture-mode').value!=='telegram';$('course-panel').hidden=true;
  $('channel-select').onchange=async()=>{try{delete $('channel-name-field').dataset.editing;$('channel-config').open=false;fillChannel(chosenChannel());$('channel-plan-item').value='';await renderChannelPlan();selectNextChannelVideo();await renderChannelWorkbench();await chrome.storage.local.set({selectedTelegramChannel:$('channel-select').value});persist();}catch(error){$('channel-status').textContent=error.message;}};
  $('channel-save').onclick=async()=>{try{await saveTelegramProfile();$('channel-status').textContent=L('channelSaved');}catch(error){$('channel-status').textContent=error.message;}};
  $('channel-open').onclick=()=>{try{const link=($('channel-message-url').value.trim()?telegramMessage($('channel-message-url').value).url:'') || telegramLink($('channel-url').value) || 'https://web.telegram.org/';window.open(link,'_blank','noopener,noreferrer');}catch(error){$('channel-status').textContent=error.message;}};
  $('channel-message-url').onchange=async()=>{try{const message=telegramMessage($('channel-message-url').value);$('channel-message-url').value=message.url;await saveTelegramProfile();updateTelegramFilename();await renderChannelWorkbench();$('channel-status').textContent=E('已自动归类：','Grouped automatically: ')+chosenChannel().name+E(' · 消息 ',' · Message ')+message.messageId;}catch(error){$('channel-status').textContent=error.message;}};
  for(const id of ['channel-name','channel-episode','channel-video-title'])$(id).oninput=updateTelegramFilename;
  $('channel-plan-item').onchange=()=>{const item=chosenChannel()?.plan?.find(item=>item.id===$('channel-plan-item').value);$('channel-video-title').value=item?.title || '';$('channel-message-url').value=item?.url || '';updateTelegramFilename();renderChannelWorkbench().catch(error=>$('channel-status').textContent=error.message);};
  $('channel-save-plan').onclick=async()=>{const planText=$('channel-plan').value;try{
    const old=chosenChannel()?.plan || [];
    const seen=new Set();
    const plan=planText.split('\n').filter(line=>line.trim()).map(line=>{const split=line.indexOf('|');const message=telegramMessage(split<0?line.trim():line.slice(split+1).trim()),title=split<0?E('视频 ','Video ')+message.messageId:line.slice(0,split).trim(),url=message.url;if(!title || !url)throw new Error(L('planInvalid'));if(seen.has(url))throw new Error(E('清单含重复的消息链接。','Duplicate message link in the plan.'));seen.add(url);return {id:old.find(item=>item.url===url)?.id || crypto.randomUUID(),title:title.slice(0,120),url,status:old.find(item=>item.url===url)?.status || 'waiting'};});
    const keys=new Set(plan.map(item=>telegramMessage(item.url).key));if(keys.size>1)throw new Error(E('一份清单只放同一频道的视频，请分频道添加。','Use one channel per plan; add different channels separately.'));
    if(plan.length)$('channel-message-url').value=plan[0].url;
    const profile=await saveTelegramProfile();
    await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...profile,plan},`channel:${profile.id}`));await loadTelegramProfiles(profile.id);selectNextChannelVideo();$('channel-status').textContent=L('channelSaved');$('channel-plan-dialog').close();await renderChannelWorkbench();
  }catch(error){$('channel-plan').value=planText;$('channel-status').textContent=error.message;}};
}
window.addEventListener('wescreen-language',async()=>{if(document.readyState!=='complete')return;const draft=$('channel-plan').value;try{await loadTelegramProfiles($('channel-select').value);$('channel-plan').value=draft;}catch(error){$('channel-status').textContent=error.message;}});

async function renderChannelWorkbench(){
 const generation=++channelRenderGeneration,profile=chosenChannel(),list=$('channel-plan-rows');const records=await readStore('recordings');if(generation!==channelRenderGeneration)return;list.replaceChildren();$('channel-queue').hidden=false;$('channel-plan-empty').hidden=!!profile?.plan?.length;$('channel-plan-progress').textContent=`${(profile?.plan || []).filter(item=>records.some(record=>record.channelTaskId===item.id)).length} / ${profile?.plan?.length || 0} `+E('已完成','complete');if(!profile)return;
 for(const [index,item] of profile.plan.entries()){
  const done=records.some(entry=>entry.channelTaskId===item.id),active=recorder && recorder.state!=='inactive' && captureChannelContext?.channelTaskId===item.id;
  const row=document.createElement('li');row.className='channel-plan-row';row.classList.toggle('selected',item.id===$('channel-plan-item').value);const number=document.createElement('span');number.className='plan-number';number.textContent=String(index+1).padStart(3,'0');row.append(number);const info=document.createElement('div');info.className='plan-info';const title=document.createElement('strong');title.textContent=item.title;info.append(title);const link=document.createElement('a');link.href=telegramLink(item.url);link.target='_blank';link.rel='noopener noreferrer';link.textContent=new URL(item.url).host+new URL(item.url).pathname;info.append(link);row.append(info);const label=document.createElement('span');label.className='plan-status';label.dataset.state=active ? 'active':done ? 'done':item.status==='skipped' ? 'skipped':'waiting';label.textContent=(active ? (recorder.state==='paused' ? E('已暂停','Paused'):E('录制中','Recording')):done ? E('已完成','Complete'):item.status==='skipped' ? E('已跳过','Skipped'):E('待录','Pending'));row.append(label);
  const controls=document.createElement('div');controls.className='controls';
  const button=(text,action)=>{const b=document.createElement('button');b.className='quiet';b.textContent=text;b.onclick=async()=>{try{await action();await renderChannelWorkbench();}catch(error){$('channel-status').textContent=error.message;}};controls.append(b);return b;};
  button(E('打开视频','Open video'),()=>window.open(telegramLink(item.url),'_blank','noopener,noreferrer'));
  const menu=document.createElement('details');menu.className='row-menu';const summary=document.createElement('summary');summary.textContent='⋯';summary.setAttribute('aria-label',L('more'));menu.append(summary);const menuItems=document.createElement('div');menuItems.className='menu-items';
  const openButton=controls.firstElementChild;
  button(E('选择 / 重录','Select / rerecord'),()=>{$('channel-plan-item').value=item.id;$('channel-plan-item').dispatchEvent(new Event('change'));});
  const save=async plan=>{await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...profile,plan},'channel:'+profile.id));await refreshTelegramProfiles();const draft=$('channel-plan').value;await renderChannelPlan();$('channel-plan').value=draft;};
  button(item.status==='skipped' ? E('恢复待录','Restore'):E('跳过','Skip'),()=>save(profile.plan.map(value=>value.id===item.id ? {...value,status:item.status==='skipped' ? 'waiting':'skipped'}:value)));
  const up=button('↑',()=>{const plan=[...profile.plan];[plan[index-1],plan[index]]=[plan[index],plan[index-1]];return save(plan);});up.disabled=index===0;up.setAttribute('aria-label',E('上移','Move up'));
  const down=button('↓',()=>{const plan=[...profile.plan];[plan[index+1],plan[index]]=[plan[index],plan[index+1]];return save(plan);});down.disabled=index===profile.plan.length-1;down.setAttribute('aria-label',E('下移','Move down'));
  while(controls.children.length>1)menuItems.append(controls.children[1]);menu.append(menuItems);controls.append(menu);row.append(controls);list.append(row);
 }
}

// No guessed playback controls. Auto-stop is available only for a verified source video.
let telegramEndTimer=null,telegramEndBusy=false,telegramEndEpoch=0,telegramSourceStarted=false;
function stopTelegramSourceMonitor(){clearInterval(telegramEndTimer);telegramEndTimer=null;telegramEndEpoch++;telegramSourceStarted=false;telegramAutoPause=false;telegramBufferSince=0;telegramLastTime=null;telegramUnverified=0;telegramCaptureNotice='';}
function startTelegramSourceMonitor(){
 stopTelegramSourceMonitor();if($('capture-mode').value!=='telegram'||$('capture-method').value!=='tab'||!captureChannelContext?.messageId)return;
 const epoch=telegramEndEpoch;
 telegramEndTimer=setInterval(async()=>{
  if(telegramEndBusy||!recorder||recorder.state==='inactive'||(recorder.state==='paused'&&!telegramAutoPause)||activeSegment?.awaitingNext)return;
  telegramEndBusy=true;
  try{
   const status=await chrome.runtime.sendMessage({type:'telegram-source-status',messageId:captureChannelContext.messageId,channelKey:captureChannelContext.channelKey});
   if(epoch!==telegramEndEpoch||!recorder||recorder.state==='inactive')return;
   if(compositor?.telegramCrop)compositor.worker.postMessage({type:'region',region:status?.verified?status.region:null});
   if(!status?.verified){if(compositor?.telegramCrop&&++telegramUnverified>=2&&recorder.state==='recording'){pause(true);telegramAutoPause=true;telegramCaptureNotice=E('目标视频暂时无法核对，已暂停录制；确认原消息后继续。','Cannot verify the target video. Recording paused; confirm the original message to continue.');}return;}
   telegramUnverified=0;
   const diagnostic=activeSegment?.channelMetadata?.captureDiagnostics;if(diagnostic){if(!Number.isFinite(diagnostic.sourceStartTime))diagnostic.sourceStartTime=status.time;diagnostic.sourceEndTime=status.time;diagnostic.sourceDuration=status.duration;diagnostic.sourceWidth=status.videoWidth;diagnostic.sourceHeight=status.videoHeight;}
   const stalled=!status.ended&&!status.paused&&status.readyState<3&&telegramLastTime!==null&&Math.abs(status.time-telegramLastTime)<.05;
   telegramLastTime=status.time;
   if(stalled){telegramBufferSince ||= Date.now();if(Date.now()-telegramBufferSince>=1500&&recorder.state==='recording'){pause(true);telegramAutoPause=true;if(diagnostic)diagnostic.bufferPauses=(diagnostic.bufferPauses||0)+1;telegramCaptureNotice=E('目标视频正在缓冲，录制自动暂停。','Source video buffering; recording paused automatically.');}}
   else{telegramBufferSince=0;if(telegramAutoPause&&status.readyState>=3&&!status.paused&&!status.ended&&(!compositor?.telegramCrop||status.region)){telegramAutoPause=false;telegramCaptureNotice='';if(recorder.state==='paused')pause(true);}}

   if(status.time>.3&&!status.ended)telegramSourceStarted=true;
   if(telegramSourceStarted&&status.ended&&status.duration>0&&status.time>=status.duration-.15){
    stopTelegramSourceMonitor();$('recording-alert').hidden=false;$('recording-alert').textContent=E('目标视频已播放结束，正在保存录像。','The verified source video ended. Saving the recording.');stop();
   }
  }catch{/* Losing access must never stop or redirect a recording. */}finally{telegramEndBusy=false;}
 },1000);
}

let telegramCaptureNotice='',telegramCaptureCropSize=null,telegramAutoPause=false,telegramBufferSince=0,telegramLastTime=null,telegramUnverified=0;
function clearTelegramAutoPause(){telegramAutoPause=false;telegramBufferSince=0;telegramCaptureNotice='';}
async function telegramSelectedVideoStatus(){return chrome.runtime.sendMessage({type:'telegram-source-status',messageId:captureChannelContext?.messageId,channelKey:captureChannelContext?.channelKey});}
async function prepareTelegramCaptureStream(stream){
 telegramCaptureCropSize=null;if($('capture-mode').value!=='telegram'||$('capture-method').value!=='tab'||!captureChannelContext?.messageId)return stream;
 let status;try{status=await telegramSelectedVideoStatus();}catch{}
 captureChannelContext.captureDiagnostics={audioObserved:false,audioSamples:0,bufferPauses:0,maxWriteAge:0,...(status?.verified?{sourceStartTime:status.time,sourceEndTime:status.time,sourceDuration:status.duration,sourceWidth:status.videoWidth,sourceHeight:status.videoHeight}:{})};
 if(!status?.verified||!status.region||!window.MediaStreamTrackProcessor||!window.MediaStreamTrackGenerator){setNotice(E('未能确认目标视频区域，保留标签页完整画面。请在录制前检查中确认消息和声音。','Cannot verify the video region. Keeping the full tab; confirm the message and audio in preflight.'));return stream;}
 const processor=new MediaStreamTrackProcessor({track:stream.getVideoTracks()[0]}),output=new MediaStreamTrackGenerator({kind:'video'}),worker=new Worker('telegram-crop-worker.js');compositor={worker,output,telegramCrop:true};
 await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error(E('视频区域采集启动超时。','Video region capture timed out.'))),10000);worker.onmessage=({data})=>{if(data.type==='ready'){clearTimeout(timer);telegramCaptureCropSize={width:data.width,height:data.height};resolve();}else if(data.type==='error'){clearTimeout(timer);reject(new Error(data.message));if(recorder?.state==='recording')stop();}};worker.onerror=e=>{clearTimeout(timer);reject(new Error(e.message));};worker.postMessage({screen:processor.readable,output:output.writable,region:status.region},[processor.readable,output.writable]);});
 captureChannelContext={...captureChannelContext,videoRegion:true,sourceVideoWidth:status.videoWidth,sourceVideoHeight:status.videoHeight,sourceVideoDuration:status.duration,sourceStartTime:status.time};
 if(status.time>.5)setNotice(E('目标视频已播放到 ','Source is already at ')+status.time.toFixed(1)+E(' 秒。当前会从这里开始录制。',' seconds; recording starts here.'));
 return new MediaStream([output]);
}
