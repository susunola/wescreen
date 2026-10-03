// Durable post-recording cleanup. Never replace or automatically download originals.
const tailEnabled=proControl('auto-static-tail','录完自动去掉超过一分钟的静止尾段','Remove terminal still scenes over one minute after recording','checkbox');tailEnabled.querySelector('input').checked=true;
const tailSilent=proControl('static-tail-silence','同时要求尾段无声（保护解说，推荐）','Require a silent tail too (protect narration, recommended)','checkbox');tailSilent.querySelector('input').checked=true;
polishLabel(tailEnabled.querySelector('span'),'录完自动去掉超过一分钟的静止尾段','Remove terminal still scenes over one minute after recording');polishLabel(tailSilent.querySelector('span'),'同时要求尾段无声（保护解说，推荐）','Require a silent tail too (protect narration, recommended)');
captureProGrid.append(tailEnabled,tailSilent);
SETTING_FIELDS.push(['auto-static-tail','checked'],['static-tail-silence','checked']);
for(const id of ['auto-static-tail','static-tail-silence'])$(id).addEventListener('change',persist);
const tailStatus=document.createElement('p');tailStatus.id='smart-tail-status';tailStatus.className='hint';tailStatus.setAttribute('role','status');$('result').append(tailStatus);
const tailQueueKey='smart-tail-pending';let tailChecking=false;
async function mutateTailQueue(change){return runTx('meta','readwrite',tx=>{const store=tx.objectStore('meta'),request=store.get(tailQueueKey);request.onsuccess=()=>store.put(change(request.result||[]),tailQueueKey);});}
async function queueSmartTail(id,requireSilence=$('static-tail-silence').checked){
 const group=recordingGroups((await readStore('recordings')).filter(e=>!e.deletedAt)).find(e=>e.id===id||e._parts?.some(p=>p.id===id));
 if(!group || group.duration<=61000)return;
 await mutateTailQueue(queue=>queue.some(item=>item.sourceId===group.id)?queue.map(item=>item.sourceId===group.id&&item.error?{sourceId:group.id,requireSilence,createdAt:Date.now()}:item):[...queue,{sourceId:group.id,requireSilence,createdAt:Date.now()}]);
 tailStatus.textContent=helperHealth?.smartTail?E('智能收尾已排队，原录像可继续播放。','Smart tail queued. The original remains playable.'):E('智能收尾等待新版本机程序连接；原录像已保存。','Smart tail is waiting for the updated helper. Original saved.');
 processSmartTailQueue().catch(error=>tailStatus.textContent=error.message);
}
polishButton('player-trim-static','检查并裁掉静止尾段','Check and trim static tail',async()=>{if(finalId)await queueSmartTail(finalId);},proPlayerTools);
async function processSmartTailQueue(){
 if(tailChecking || !helperHealth?.smartTail)return;tailChecking=true;
 try{await navigator.locks.request('wescreen-smart-tail',{ifAvailable:true},async lock=>{
  if(!lock)return;const queue=await readStore('meta',tailQueueKey)||[],item=queue.find(i=>!i.error);if(!item)return;
  const group=recordingGroups((await readStore('recordings')).filter(e=>!e.deletedAt)).find(e=>e.id===item.sourceId||e._parts?.some(p=>p.id===item.sourceId));
  if(!group){await mutateTailQueue(items=>items.filter(i=>i.sourceId!==item.sourceId));return;}
  try{
   let task=item.jobId?await readStore('tasks',item.jobId):null;
   if(!task){
    const {jobs}=await(await enhancementRequest('/jobs')).json();
    const existing=jobs.find(j=>j.sourceId===item.sourceId&&j.batchRef==='smart-tail:'+item.sourceId&&j.state!=='error'&&j.state!=='cancelled');
    if(existing)task={...existing,autoTrim:true};
    else if(group._parts){
     const uploads=[];for(const part of group._parts){const blob=await readStore('videos',part.id);if(!blob)throw new Error(L('errEmpty'));uploads.push((await(await enhancementRequest('/uploads',{method:'POST',body:blob})).json()).id);}
     const created=await(await enhancementRequest('/jobs/merge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({parts:uploads,name:group.name,sourceId:group.id,smartTail:true,requireSilence:item.requireSilence,batchRef:'smart-tail:'+group.id})})).json();
     task={id:created.id,mode:'merge',sourceId:group.id,name:group.name,smartTail:true,requireSilence:item.requireSilence,autoTrim:true,createdAt:Date.now()};
    }else task=await submitProcessing(group,{mode:'trimstatic',preview:false,requireSilence:item.requireSilence,batchRef:'smart-tail:'+group.id,autoTrim:true});
    await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put(task));await mutateTailQueue(items=>items.map(i=>i.sourceId===item.sourceId?{...i,jobId:task.id}:i));
   }
   const info=await(await enhancementRequest('/jobs/'+task.id)).json();
   tailStatus.textContent=E('智能收尾：正在检查尾部画面与声音，原录像保留。','Smart tail: checking terminal picture and audio. Original retained.');
   if(info.state==='error'||info.state==='cancelled')throw new Error(info.error||L('jobCancelled'));
   if(info.state==='done'){
    let savedId=null;if(info.tailRemoved>60)savedId=await saveTaskResult({...task,...info});
    await mutateTailQueue(items=>items.filter(i=>i.sourceId!==item.sourceId));
    tailStatus.textContent=savedId?E('已去掉静止尾段 ','Removed static tail ')+fmt(info.tailRemoved*1000)+E('，修剪版已存入录像库；原录像保留。','. Trimmed version saved; original retained.'):E('检查完成：没有符合条件的尾段，录像保留完整。','Checked: no qualifying tail. Recording kept complete.');
    await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put({...task,...info,...(savedId?{savedId}:{})}));
   }
  }catch(error){if(/Another.*running|busy|HTTP 409|Failed to fetch|fetch failed/.test(error.message)){tailStatus.textContent=E('智能收尾等待本机程序空闲或恢复连接。','Smart tail is waiting for the helper to become available.');return;}
   await mutateTailQueue(items=>items.map(i=>i.sourceId===item.sourceId?{...i,error:error.message}:i));tailStatus.textContent=E('智能收尾未完成；原录像保留。请在视频处理页检查任务：','Smart tail incomplete; original retained. Check the task in Video processing: ')+error.message;
  }
 });}finally{tailChecking=false;}
}
const smartTailTimer=setInterval(()=>processSmartTailQueue().catch(error=>tailStatus.textContent=error.message),3000);
window.addEventListener('pagehide',()=>clearInterval(smartTailTimer));
