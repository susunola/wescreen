// Channel profiles and a user-managed recording plan; capture still uses the browser picker.
let telegramProfiles=[], captureChannelContext=null, channelRenderGeneration=0;
function safePart(value){return String(value||'').trim().replace(/[\\/:*?"<>|]/g,'-').replace(/^\.+$/,'').slice(0,80);}
function telegramLink(value){
  if(!value?.trim())return '';
  const url=new URL(/^https?:\/\//i.test(value.trim())?value.trim():'https://'+value.trim());
  if(!['t.me','telegram.me','web.telegram.org'].includes(url.hostname) || !['https:','http:'].includes(url.protocol))throw new Error(L('telegramLinkInvalid'));
  url.protocol='https:';return url.href;
}
function relativeFolder(value){return String(value||'').split(/[\\/]/).map(safePart).filter(Boolean).join('/').slice(0,180);}
async function refreshTelegramProfiles(){telegramProfiles=(await readStore('meta')).filter(value=>value?.channelProfile);return telegramProfiles;}
function chosenChannel(){return telegramProfiles.find(profile=>profile.id===$('channel-select').value);}
function updateTelegramFilename(){
  $('channel-number-summary').textContent=E('自动编号 ','Next number ')+String(Math.max(1,Number($('channel-episode').value)||1)).padStart(3,'0')+E(' · 保存到本机录像库',' · Saved in the local library');
  $('channel-name-field').hidden=!!chosenChannel() && !$('channel-name-field').dataset.editing;
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
  $('channel-plan').value=(profile?.plan || []).map(item=>`${item.title} | ${item.url}`).join('\n');
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
  const name=$('channel-name').value.trim();if(!name)throw new Error(L('channelNameRequired'));
  const existing=chosenChannel(),id=existing?.id || crypto.randomUUID();
  const profile={...existing,id,channelProfile:true,name:name.slice(0,80),url:telegramLink($('channel-url').value),nextEpisode:Math.max(1,Number($('channel-episode').value)||1),exportFolder:relativeFolder($('channel-folder').value) || `WeScreen/Telegram/${safePart(name)}`,plan:existing?.plan || []};
  await runTx('meta','readwrite',tx=>tx.objectStore('meta').put(profile,`channel:${id}`));await loadTelegramProfiles(id);
  $('channel-folder').value=profile.exportFolder;$('channel-config').open=false;await chrome.storage.local.set({selectedTelegramChannel:id});persist();return profile;
}
async function prepareTelegramChannel(){
  captureChannelContext=null;if($('capture-mode').value!=='telegram')return;
  const profile=await saveTelegramProfile();updateTelegramFilename();
  const taskId=$('channel-plan-item').value;const existing=(await readStore('recordings')).filter(entry=>entry.channelTaskId && entry.channelTaskId===taskId && !entry.deletedAt);if(existing.length && !confirm(E('这条消息已有录像，仍要录制新的版本吗？','This message already has recordings. Record another version?')))throw new Error(E('已取消重录。','Rerecord cancelled.'));
  captureChannelContext={channelId:profile.id,channelName:profile.name,channelUrl:profile.url,course:profile.name,episode:profile.nextEpisode,sourceUrl:telegramLink($('channel-message-url').value),sourceTitle:$('channel-video-title').value.trim(),channelTaskId:$('channel-plan-item').value || null,exportFolder:profile.exportFolder};
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
  $('channel-new').onclick=async()=>{$('channel-select').value='';$('channel-select').dispatchEvent(new Event('change'));$('channel-name-field').hidden=false;$('channel-name').focus();};
  $('channel-manage').onclick=()=>{$('channel-name-field').dataset.editing='true';$('channel-name-field').hidden=false;$('channel-config').open=true;$('channel-name').focus();};
  $('channel-clear-completed').onclick=async()=>{try{const profile=chosenChannel();if(!profile)return;const records=await readStore('recordings'),completed=new Set(records.map(record=>record.channelTaskId));const plan=profile.plan.filter(item=>!completed.has(item.id));if(plan.length===profile.plan.length)return;if(!confirm(E('从清单移除已完成项？已保存的录像保留。','Remove completed plan items? Saved recordings are preserved.')))return;await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...profile,plan},'channel:'+profile.id));await refreshTelegramProfiles();await renderChannelPlan();await renderChannelWorkbench();}catch(error){$('channel-status').textContent=error.message;}};
  const {selectedTelegramChannel}=await chrome.storage.local.get('selectedTelegramChannel');await loadTelegramProfiles(selectedTelegramChannel);if(chosenChannel()){fillChannel(chosenChannel());selectNextChannelVideo();$('channel-config').open=false;}
  $('telegram-channel').hidden=$('capture-mode').value!=='telegram';$('course-panel').hidden=true;
  $('channel-select').onchange=async()=>{try{delete $('channel-name-field').dataset.editing;$('channel-config').open=false;fillChannel(chosenChannel());$('channel-plan-item').value='';await renderChannelPlan();selectNextChannelVideo();await renderChannelWorkbench();await chrome.storage.local.set({selectedTelegramChannel:$('channel-select').value});persist();}catch(error){$('channel-status').textContent=error.message;}};
  $('channel-save').onclick=async()=>{try{await saveTelegramProfile();$('channel-status').textContent=L('channelSaved');}catch(error){$('channel-status').textContent=error.message;}};
  $('channel-open').onclick=()=>{try{const link=telegramLink($('channel-message-url').value) || telegramLink($('channel-url').value) || 'https://web.telegram.org/';window.open(link,'_blank','noopener,noreferrer');}catch(error){$('channel-status').textContent=error.message;}};
  for(const id of ['channel-name','channel-episode','channel-video-title'])$(id).oninput=updateTelegramFilename;
  $('channel-plan-item').onchange=()=>{const item=chosenChannel()?.plan?.find(item=>item.id===$('channel-plan-item').value);$('channel-video-title').value=item?.title || '';$('channel-message-url').value=item?.url || '';updateTelegramFilename();renderChannelWorkbench().catch(error=>$('channel-status').textContent=error.message);};
  $('channel-save-plan').onclick=async()=>{const planText=$('channel-plan').value;try{
    const old=chosenChannel()?.plan || [];
    const seen=new Set();
    const plan=planText.split('\n').filter(line=>line.trim()).map(line=>{const split=line.indexOf('|');if(split<0)throw new Error(L('planInvalid'));const title=line.slice(0,split).trim(),url=telegramLink(line.slice(split+1).trim());if(!title || !url)throw new Error(L('planInvalid'));if(seen.has(url))throw new Error(E('清单含重复的消息链接。','Duplicate message link in the plan.'));seen.add(url);return {id:old.find(item=>item.url===url)?.id || crypto.randomUUID(),title:title.slice(0,120),url,status:old.find(item=>item.url===url)?.status || 'waiting'};});
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
