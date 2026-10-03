// Authenticated loopback client. Full results are retained until explicit deletion.
const ENHANCER_URL = 'http://127.0.0.1:8765';
const E = (zh,en) => LANG === 'zh' ? zh : en;
let enhancementToken = '', enhancementSource = null, enhancementBusy = false, enhancementJob = null;
let enhancementUrls = [], enhancementOutputUrl = null, enhancementPreviewMode = null, enhancementPreviewOffset = 0;
let helperHealth = null, taskPolling = false, comparisonActive = false;
function enhancementStatus(text) { $('enhance-status').textContent = text; }
async function enhancementRequest(path,options={}) {
  const response = await fetch(ENHANCER_URL+path,{...options,signal:options.signal || ((!options.method || options.method==='GET') && !path.endsWith('/result') ? AbortSignal.timeout(15000):undefined),headers:{...options.headers,'X-WeScreen-Token':enhancementToken},cache:'no-store'});
  if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error || `HTTP ${response.status}`);} return response;
}
function clearEnhancementPreview() {
  comparisonActive = false;$('compare-zoom').value='1';for(const id of ['enhance-original','enhance-output'])$(id).style.width='100%';
  for(const id of ['enhance-original','enhance-output']){const video=$(id);video.pause();video.removeAttribute('src');video.load();}
  enhancementUrls.forEach(url=>URL.revokeObjectURL(url));enhancementUrls=[];enhancementOutputUrl=null;
}
let helperConnecting=null;
async function discoverHelperToken(){
 const response=await fetch(ENHANCER_URL+'/connect',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}',cache:'no-store',signal:AbortSignal.timeout(3000)});
 if(!response.ok){const error=await response.json().catch(()=>({}));throw new Error(error.error || `HTTP ${response.status}`);}
 const data=await response.json();if(typeof data.token!=='string' || !/^[A-Za-z0-9_-]{20,128}$/.test(data.token))throw new Error(E('本机连接响应无效。','Invalid helper connection response.'));
 enhancementToken=data.token;$('enhance-token').value=enhancementToken;
}
async function connectHelper(){
 if(helperConnecting)return helperConnecting;
 helperConnecting=(async()=>{
  enhancementToken=$('enhance-token').value.trim();helperHealth=null;updateEnhancementMode();$('helper-status').textContent=E('正在自动连接本机程序…','Connecting to local helper…');
  try{
   if(!enhancementToken)await discoverHelperToken();
   try{helperHealth=await(await enhancementRequest('/health')).json();}catch(error){if(!/401|Invalid local access token/.test(error.message))throw error;await discoverHelperToken();helperHealth=await(await enhancementRequest('/health')).json();}
   if(chrome.storage.session)await chrome.storage.session.set({enhancementToken});
   $('helper-status').textContent=L('connectReady');$('helper-connection').open=false;updateEnhancementMode();await renderEnhancementTasks();return helperHealth;
  }catch(error){$('helper-status').textContent=/paired with another/.test(error.message) ? E('本机程序已连接另一扩展。请在原扩展目录更新版本，或使用高级连接设置。','Helper is paired with another extension. Update the original extension directory or use Advanced connection settings.') : E('未连接本机程序。请先启动它，窗口打开时会自动重试。','Local helper unavailable. Start it; this dialog retries automatically.');updateEnhancementMode();return null;}
 })();try{return await helperConnecting;}finally{helperConnecting=null;}
}
function enhancementControls(busy) {
  enhancementBusy=busy;$('enhance-progress').hidden=!busy;$('enhance-cancel').hidden=!busy;
  for(const id of ['enhance-preview','enhance-full','enhance-mode','enhance-token','enhance-start','preview-seconds'])$(id).disabled=busy;
  $('enhance-cancel').disabled=!busy || !enhancementJob;
  updateEnhancementMode();
}
function updateEnhancementMode() {
  $('helper-actions').hidden=!!helperHealth;$('helper-auto-hint').hidden=!!helperHealth;$('model-setup-link').hidden=!helperHealth || (helperHealth.ai && helperHealth.strong);
  for(const [mode,key] of [['strong','modeStrong'],['ai','modeAI']]){const option=$('enhance-mode').querySelector(`[value="${mode}"]`),reason=!helperHealth ? E('先连接本机程序','connect helper first'):!helperHealth[mode] ? E('未安装模型','model not installed'):'';option.disabled=!!reason;option.textContent=L(key)+(reason ? ` (${reason})`:'');}
  $('model-availability').textContent=!helperHealth ? E('AI 模式暂不可选：尚未连接本机程序。启动后会自动检测模型。','AI modes unavailable: connect the local helper to check installed models.') : [!helperHealth.strong ? E('强力 AI 未安装：打开安装说明，安装 SeedVR2 模型。','Strong AI unavailable: open setup instructions to install SeedVR2.'):'',!helperHealth.ai ? E('轻量 AI 未安装：请使用完整的新版本机程序包。','Lightweight AI unavailable: use the complete updated helper package.'):''].filter(Boolean).join(' ');
  for(const option of $('preview-seconds').options)option.textContent=option.value+E(' 秒',' seconds');
  $('enhance-preview').textContent=E('预览 ','Preview ')+$('preview-seconds').value+E(' 秒',' seconds');
  if($('enhance-mode').selectedOptions[0]?.disabled)$('enhance-mode').value='natural';
  const mode=$('enhance-mode').value;
  $('enhance-mode-hint').textContent=mode==='strong' ? E('SeedVR2 可能改变人脸与字幕。处理较慢，先预览确认；输入/输出最高 1080p。','SeedVR2 can alter faces and subtitles. Processing is slow; preview first. Up to 1080p input/output.') : mode==='natural' ? E('保留原分辨率，减少压缩块和噪点，轻度锐化。','Preserves resolution, reduces compression artifacts and noise, and gently sharpens.') : E('先选择片段预览。明暗增强仍为 SDR，AI 无法保证还原丢失细节。','Preview a selected clip first. Brightness output stays SDR; AI cannot guarantee lost details are recovered.');
  $('enhance-preview').disabled=enhancementBusy || !enhancementSource || !helperHealth;
  $('enhance-full').disabled=enhancementBusy || !enhancementSource || !helperHealth || (mode==='strong' && enhancementPreviewMode!=='strong');
  $('enhance-disabled-reason').textContent=enhancementBusy ? E('正在处理，请等待完成或取消当前任务。','Processing: wait or cancel the current task.') : !enhancementSource ? E('请先从录像库选择一段视频，再使用画质增强。','Select a video in the library to enable enhancement.') : !helperHealth ? E('按钮暂不可用：本机程序尚未连接。','Buttons unavailable: local helper is not connected.') : mode==='strong' && enhancementPreviewMode!=='strong' ? E('整段增强暂不可用：先生成一段强力 AI 预览，确认效果。','Full processing unavailable: generate a Strong AI preview first.') : '';
}
async function openEnhancement(entry=null) {
  if(enhancementBusy){navigateWorkspace('tasks');return;}
  enhancementSource=entry;enhancementPreviewMode=null;comparisonActive=false;clearEnhancementPreview();
  $('enhance-title').textContent=entry ? E('画质增强：','Enhance: ')+entry.name : L('helperConnection');
  $('enhance-estimate').textContent='';$('enhance-start').value='0';$('enhance-progress').value=0;
  $('enhance-panel').showModal();$('helper-connection').open=false;
  enhancementStatus('');
  if(entry){const blob=await readStore('videos',entry.id);if(!blob)throw new Error(L('errEmpty'));const url=URL.createObjectURL(blob);enhancementUrls.push(url);$('enhance-original').src=url;}
  await connectHelper();
}
function resultName(task) {
  const label=task.mode==='edit' ? 'edited' : task.mode==='strong' ? 'SeedVR2' : task.mode==='ai' ? 'AI-2x' : task.mode;
  return `${(task.name || 'video').replace(/\.(mp4|webm)$/i,'')}-${label}${task.preview ? '-preview' : ''}.mp4`;
}
async function submitProcessing(source,options) {
  enhancementToken=$('enhance-token').value.trim();if(!enhancementToken)throw new Error(L('helperOffline'));
  const blob=await readStore('videos',source.id);if(!blob)throw new Error(L('errEmpty'));
  const query=new URLSearchParams({mode:options.mode,preview:options.preview ? '1':'0',start:String(options.start || 0),end:String(options.end || 0),sourceId:source.id,name:source.name});
  if(options.previewSeconds)query.set('previewSeconds',String(options.previewSeconds));
  if(options.crop)query.set('crop',options.crop.join(','));
  if(options.landscape)query.set('landscape','1');
  if(options.rotation!==undefined)query.set('rotation',String(options.rotation));
  if(options.batchRef)query.set('batchRef',options.batchRef);
  const job=await(await enhancementRequest('/jobs?'+query,{method:'POST',body:blob,headers:{'Content-Type':blob.type || 'application/octet-stream'}})).json();
  const task={id:job.id,sourceId:source.id,name:source.name,course:source.course || '',markers:source.markers || [],createdAt:Date.now(),state:'queued',exportFolder:source.exportFolder,...options};
  // The helper also persists sourceId/name, so a quota failure here cannot orphan the result.
  await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put(task)).catch(error=>enhancementStatus(E('任务已在本机创建；浏览器任务记录失败：','Task created locally; browser metadata could not be stored: ')+error.message));
  return task;
}
async function saveTaskResult(task) {
  return navigator.locks.request(`wescreen-save-job-${task.id}`,async()=>{
    const existing=(await readStore('recordings')).find(entry=>entry.helperJobId===task.id);
    if(existing)return existing.id;
    const info=await(await enhancementRequest(`/jobs/${task.id}`)).json();
    if(info.state!=='done')throw new Error(E('任务尚未完成。','Task has not completed.'));
    if(info.size>HEAP_LIMIT_BYTES)throw new Error(E('结果超过录像库单文件限制，请直接导出；结果仍在本机。','Result exceeds the library per-file limit. Export directly; it remains on this device.'));
    const estimate=await navigator.storage?.estimate?.();
    if(!hasUnlimitedStorage() && estimate && estimate.quota-estimate.usage<info.size*1.1)throw new Error(E('录像库存储空间不足，请直接导出。','Library storage is insufficient. Export directly.'));
    const blob=await(await enhancementRequest(`/jobs/${task.id}/result`)).blob();
    const original=await readStore('recordings',task.sourceId);
    const id=crypto.randomUUID();let savedId=id;
    const entry={id,name:resultName(task),size:blob.size,createdAt:Date.now(),duration:info.duration*1000,width:info.width,height:info.height,course:task.course || original?.course || '',markers:task.mode==='edit' ? (original?.markers || []).filter(m=>m.at>=task.start*1000 && (!task.end || m.at<task.end*1000)).map(m=>({...m,at:m.at-task.start*1000})) : original?.markers || task.markers || [],enhancedFrom:task.sourceId,enhancement:task.mode,helperJobId:task.id,channelId:original?.channelId,channelName:original?.channelName,channelUrl:original?.channelUrl,sourceUrl:original?.sourceUrl,channelTaskId:original?.channelTaskId,exportFolder:original?.exportFolder || task.exportFolder};
    await runTx(['recordings','videos','tasks'],'readwrite',tx=>{
      const request=tx.objectStore('recordings').getAll();request.onsuccess=()=>{
        const duplicate=request.result.find(item=>item.helperJobId===task.id);
        if(duplicate){savedId=duplicate.id;return;}
        tx.objectStore('recordings').add(entry);tx.objectStore('videos').add(blob,id);tx.objectStore('tasks').put({...task,...info,savedId:id});
      };
    });
    saveThumbnail(blob,savedId).catch(()=>{});await renderRecordingLibrary();return savedId;
  });
}
async function exportTask(task) {
  const ticket=await(await enhancementRequest(`/jobs/${task.id}/export`,{method:'POST'})).json();
  // Native download streams from disk, avoiding a multi-gigabyte Blob in the browser heap.
  if(chrome.downloads?.download){const source=task.sourceId ? await readStore('recordings',task.sourceId):null;const folder=relativeFolder(task.exportFolder || source?.exportFolder || '');await chrome.downloads.download({url:ticket.url,filename:(folder ? folder+'/':'')+resultName(task),saveAs:true});}
  else {const anchor=document.createElement('a');anchor.href=ticket.url;anchor.download=resultName(task);anchor.click();}
}
async function enhanceVideo(preview) {
  if(enhancementBusy || !enhancementSource)return;
  const source=enhancementSource,mode=$('enhance-mode').value,start=preview ? Math.max(0,$('enhance-original').currentTime || 0):0,previewSeconds=Number($('preview-seconds').value) || 5;
  if(!Number.isFinite(start) || start<0){enhancementStatus(E('预览起点无效。','Invalid preview start.'));return;}
  const began=performance.now();let task=null;enhancementControls(true);
  try {
    task=await submitProcessing(source,{mode,preview,start,previewSeconds});enhancementJob=task.id;$('enhance-cancel').disabled=false;
    while(true){
      const info=await(await enhancementRequest(`/jobs/${task.id}`)).json();$('enhance-progress').value=info.progress || 0;
      const phase=info.detail?.phase;enhancementStatus(info.stage==='SeedVR2' ? `SeedVR2 · ${phase || E('加载模型 / 重建细节','Loading / restoring')}${info.detail ? ` ${info.detail.batch}/${info.detail.batches}`:''}` : E('本机处理中：','Processing locally: ')+Math.round((info.progress || 0)*100)+'%');
      if(info.state==='error' || info.state==='cancelled')throw new Error(info.error || L('jobCancelled'));
      if(info.state==='done'){
        if(preview){
          if(info.size>HEAP_LIMIT_BYTES)throw new Error(E('预览过大，请在任务中直接导出。','Preview is too large. Export it from Tasks.'));
          const output=await(await enhancementRequest(`/jobs/${task.id}/result`)).blob();
          if($('enhance-panel').open && enhancementSource?.id===source.id){
            if(enhancementOutputUrl)URL.revokeObjectURL(enhancementOutputUrl);
            enhancementOutputUrl=URL.createObjectURL(output);enhancementUrls.push(enhancementOutputUrl);$('enhance-output').src=enhancementOutputUrl;$('enhance-output').controls=false;
            enhancementPreviewMode=mode;enhancementPreviewOffset=start;comparisonActive=true;$('enhance-original').currentTime=start;
            const seconds=(performance.now()-began)/1000,estimate=source.duration && info.duration ? seconds*source.duration/1000/info.duration:null;
            $('enhance-estimate').textContent=E('预览耗时 ','Preview took ')+Math.ceil(seconds)+E(' 秒',' seconds')+(estimate ? E('；整段粗略估计 ','; full video roughly ')+Math.ceil(estimate/60)+E(' 分钟，随素材和负载变化。',' minutes; varies with content and load.'):'');
            enhancementStatus(E('预览已完成，检查字幕、人脸和运动后再处理整段。','Preview ready. Check text, faces and motion before processing the full video.'));
          }
          // A successfully fetched preview is disposable; full results are never automatically deleted.
          await enhancementRequest(`/jobs/${task.id}`,{method:'DELETE'});await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').delete(task.id));
        }else{await saveTaskResult({...task,...info});enhancementStatus(E('已另存到录像库，本机结果也保留，可从任务中导出。','Saved to the library. The local result is also retained and can be exported from Tasks.'));}
        break;
      }
      await new Promise(resolve=>setTimeout(resolve,700));
    }
  }catch(error){enhancementStatus(E('处理未完成或保存失败：','Processing or saving failed: ')+error.message+(task ? E(' 任务结果仍可在“处理任务”中查看或导出。',' Inspect or export the retained result in Tasks.') : ''));}
  finally{enhancementJob=null;enhancementControls(false);renderEnhancementTasks().catch(()=>{});}
}
async function renderEnhancementTasks() {
  if(taskPolling)return;taskPolling=true;
  try {
    const local=await readStore('tasks');let jobs=[],remoteChecked=false;
    if(enhancementToken){try{jobs=(await(await enhancementRequest('/jobs')).json()).jobs;remoteChecked=true;$('tasks-status').textContent='';}catch(error){$('tasks-status').textContent=L('helperOffline')+' '+error.message;}}
    else $('tasks-status').textContent=L('helperOffline');
    const records=await readStore('recordings');
    const merged=new Map(local.map(task=>[task.id,task]));for(const job of jobs)merged.set(job.id,{...merged.get(job.id),...job});
    const list=$('task-items');list.replaceChildren();
    if(!merged.size){const empty=document.createElement('li');empty.textContent=L('noTasks');list.append(empty);}
    for(const task of [...merged.values()].sort((a,b)=>b.createdAt-a.createdAt)){
      const row=document.createElement('li');row.className='task-row';
      const title=document.createElement('strong');title.textContent=task.name || task.id;row.append(title);
      const saved=records.find(entry=>entry.helperJobId===task.id),remote=jobs.some(job=>job.id===task.id);
      const detail=document.createElement('p');detail.className='hint';detail.textContent=(saved ? L('jobSaved'):L({queued:'jobQueued',processing:'jobProcessing',done:'jobDone',error:'jobError',cancelled:'jobCancelled'}[task.state] || 'jobError'))+` · ${task.mode}${task.size ? ' · '+fmtBytes(task.size):''}${task.preview ? ' · '+L('enhancedPreview'):''}`;row.append(detail);
      if(task.error || (!remote && remoteChecked)){const error=document.createElement('p');error.className='hint alert';error.textContent=task.error || L('taskLost');row.append(error);}
      if(['queued','processing'].includes(task.state) && remote){const progress=document.createElement('progress');progress.max=1;progress.value=task.progress || 0;row.append(progress);}
      const buttons=document.createElement('div');buttons.className='controls';
      if(task.state==='done' && remote){if(!saved)buttons.append(libraryButton('saveLibrary',async()=>{await saveTaskResult(task);await renderEnhancementTasks();}));buttons.append(libraryButton('exportResult',()=>exportTask(task)));}
      if(['queued','processing'].includes(task.state) && remote)buttons.append(libraryButton('cancelTask',async()=>{await enhancementRequest(`/jobs/${task.id}`,{method:'DELETE'});await renderEnhancementTasks();}));
      else buttons.append(libraryButton('deleteTask',async()=>{
        if(!confirm(E('删除任务及本机处理结果？录像库已保存的版本不受影响。','Delete this task and its local result? Saved library versions are unaffected.')))return;
        if(remote)await enhancementRequest(`/jobs/${task.id}`,{method:'DELETE'});await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').delete(task.id));await renderEnhancementTasks();
      }));
      row.append(buttons);list.append(row);
    }
  }finally{taskPolling=false;}
}
function syncComparison() {
  if(!comparisonActive || !$('enhance-output').src)return;
  const master=$('enhance-original'),slave=$('enhance-output'),t=Math.max(0,master.currentTime-enhancementPreviewOffset);
  if(Number.isFinite(slave.duration) && t>slave.duration){master.pause();slave.pause();return;}
  if(Math.abs(slave.currentTime-t)>.15)slave.currentTime=t;
  slave.playbackRate=master.playbackRate;master.muted=true;slave.muted=false;
  if(master.paused)slave.pause();else slave.play().catch(()=>{});
}
for(const event of ['play','pause','seeking','timeupdate','ratechange'])$('enhance-original').addEventListener(event,syncComparison);
$('enhance-output').onended=()=>{if(comparisonActive)$('enhance-original').pause();};
$('enhance-compare').onclick=async()=>{if(!comparisonActive)return;const master=$('enhance-original');if(master.paused){const length=$('enhance-output').duration;if(master.currentTime<enhancementPreviewOffset || master.currentTime>=enhancementPreviewOffset+length)master.currentTime=enhancementPreviewOffset;await master.play();}else master.pause();syncComparison();};
$('enhance-frame').onclick=()=>{const master=$('enhance-original');master.pause();master.currentTime+=1/30;syncComparison();};
$('enhance-use-position').onclick=()=>{$('enhance-start').value=$('enhance-original').currentTime.toFixed(1);};
$('enhance-zoom').onchange=()=>document.querySelector('.enhance-comparison').classList.toggle('native-size',$('enhance-zoom').checked);
$('enhance-mode').onchange=()=>{enhancementPreviewMode=null;comparisonActive=false;$('enhance-original').pause();$('enhance-output').pause();$('enhance-output').removeAttribute('src');$('enhance-output').load();$('enhance-estimate').textContent='';updateEnhancementMode();};
$('enhance-preview').onclick=()=>enhanceVideo(true);$('enhance-full').onclick=()=>enhanceVideo(false);
$('enhance-cancel').onclick=()=>enhancementJob && enhancementRequest(`/jobs/${enhancementJob}`,{method:'DELETE'}).catch(error=>enhancementStatus(error.message));
$('enhance-close').onclick=()=>{$('enhance-panel').close();clearEnhancementPreview();};
$('enhance-panel').addEventListener('cancel',()=>clearEnhancementPreview());
$('enhance-go-tasks').onclick=()=>{$('enhance-panel').close();clearEnhancementPreview();navigateWorkspace('tasks');};
$('helper-check').onclick=connectHelper;
$('enhance-token').oninput=()=>{helperHealth=null;updateEnhancementMode();};
window.addEventListener('wescreen-language',()=>{updateEnhancementMode();if(workspaceView==='tasks')renderEnhancementTasks().catch(()=>{});});
if(chrome.storage.session)chrome.storage.session.get('enhancementToken').then(value=>{enhancementToken=value.enhancementToken || '';$('enhance-token').value=enhancementToken;if(chrome.runtime.id)connectHelper();}).catch(()=>{});
setInterval(()=>{if(workspaceView==='tasks' && !$('task-items').contains(document.activeElement))renderEnhancementTasks().catch(error=>$('tasks-status').textContent=error.message);},3000);

$('helper-token-file').onchange=async()=>{try{const file=$('helper-token-file').files[0];if(!file)return;if(file.size>1024)throw new Error(E('连接文件过大。','Connection file is too large.'));const token=(await file.text()).trim();if(!/^[A-Za-z0-9_-]{20,128}$/.test(token))throw new Error(E('连接文件无效。','Invalid connection file.'));$('enhance-token').value=token;await connectHelper();}catch(error){$('helper-status').textContent=error.message;}finally{$('helper-token-file').value='';}};
$('compare-zoom').oninput=()=>{for(const id of ['enhance-original','enhance-output'])$(id).style.width=String(Number($('compare-zoom').value)*100)+'%';};
const compareSides=document.querySelectorAll('.enhance-comparison > div');for(const side of compareSides)side.addEventListener('scroll',()=>{const other=[...compareSides].find(item=>item!==side);if(!other)return;const x=side.scrollLeft/(side.scrollWidth-side.clientWidth || 1),y=side.scrollTop/(side.scrollHeight-side.clientHeight || 1);if(Math.abs(other.scrollLeft-x*(other.scrollWidth-other.clientWidth))>1)other.scrollLeft=x*(other.scrollWidth-other.clientWidth);if(Math.abs(other.scrollTop-y*(other.scrollHeight-other.clientHeight))>1)other.scrollTop=y*(other.scrollHeight-other.clientHeight);});

$('preview-seconds').onchange=updateEnhancementMode;setInterval(()=>{if($('enhance-panel').open && !helperHealth && !enhancementBusy)connectHelper();},3000);
