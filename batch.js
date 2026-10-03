// Persisted sequential queue; a Web Lock ensures only one page dispatches uploads.
let batchRunning=false;
const batchStateKey='batch-control';
async function batchItems(){return (await readStore('meta')).filter(item=>item?.batchItem).sort((a,b)=>a.createdAt-b.createdAt);}
async function batchUpdate(item,patch){await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...item,...patch},'batch:'+item.id));}
async function renderBatch(){
 const items=await batchItems();$('batch-queue-panel').hidden=!items.length;if(items.some(item=>['waiting','processing','error'].includes(item.state)))$('batch-queue-panel').open=true;const list=$('batch-items');list.replaceChildren();for(const item of items){const row=document.createElement('li');row.textContent=`${item.name} · ${L({waiting:'jobQueued',processing:'jobProcessing',done:'jobSaved',error:'jobError'}[item.state])}${item.error ? ' · '+item.error:''}`;list.append(row);}
 $('batch-empty').hidden=items.length>0;const state=await readStore('meta',batchStateKey);$('batch-resume').disabled=batchRunning && !state?.paused;
}
async function enqueueBatch(){
 const mode=$('batch-mode').value;if(!['natural','ai','light'].includes(mode))return;
 for(const id of librarySelection){const source=await readStore('recordings',id);if(!source || source.deletedAt)continue;const idQueue=crypto.randomUUID();await batchUpdate({id:idQueue,batchItem:true,sourceId:id,name:source.name,mode,state:'waiting',createdAt:Date.now()},{ });}
 navigateWorkspace('tasks');await renderBatch();await runBatch();
}
async function runBatch(){
 if(batchRunning)return;batchRunning=true;
 try{await navigator.locks.request('wescreen-batch',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error(E('另一个页面正在运行队列。','Another page is running the queue.'));
  if(!enhancementToken)throw new Error(L('helperOffline'));
  while(!(await readStore('meta',batchStateKey))?.paused){
   const item=(await batchItems()).find(item=>['waiting','processing'].includes(item.state));if(!item)break;
   try{
    const jobs=(await(await enhancementRequest('/jobs')).json()).jobs;
    let remote=jobs.find(job=>job.batchRef===item.id),task;
    if(!remote){if(jobs.some(job=>['queued','processing'].includes(job.state)))throw new Error(E('本机已有处理任务，请稍后继续队列。','The helper is busy. Resume the queue later.'));const source=await readStore('recordings',item.sourceId);if(!source || source.deletedAt)throw new Error(L('errEmpty'));await batchUpdate(item,{state:'processing'});task=await submitProcessing(source,{mode:item.mode,preview:false,start:0,batchRef:item.id});remote={id:task.id};}
    else task=(await readStore('tasks',remote.id)) || {...remote,sourceId:item.sourceId};
    await batchUpdate(item,{state:'processing',remoteId:remote.id});await renderBatch();
    while(true){const info=await(await enhancementRequest('/jobs/'+remote.id)).json();if(info.state==='done'){await saveTaskResult({...task,...info});await batchUpdate(item,{state:'done',remoteId:remote.id,error:null});break;}if(['cancelled','error'].includes(info.state))throw new Error(info.error || L('jobCancelled'));await new Promise(r=>setTimeout(r,700));}
   }catch(error){await batchUpdate(item,{state:'error',error:error.message});$('tasks-status').textContent=error.message;await renderBatch();break;}
   await renderBatch();await renderEnhancementTasks();
  }
 });}catch(error){$('tasks-status').textContent=error.message;}finally{batchRunning=false;await renderBatch();}
}
$('batch-add').onclick=()=>enqueueBatch().catch(workspaceError);
$('batch-pause').onclick=async()=>{await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({paused:true},batchStateKey));await renderBatch();};
$('batch-resume').onclick=async()=>{await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({paused:false},batchStateKey));await runBatch();};
$('batch-retry').onclick=async()=>{for(const item of await batchItems())if(item.state==='error'){if(item.remoteId){try{const info=await(await enhancementRequest('/jobs/'+item.remoteId)).json();if(['error','cancelled'].includes(info.state))await enhancementRequest('/jobs/'+item.remoteId,{method:'DELETE'});}catch(error){if(!error.message.includes('404')){$('tasks-status').textContent=error.message;return;}}}await batchUpdate(item,{state:'waiting',error:null});}await renderBatch();};
window.addEventListener('DOMContentLoaded',()=>renderBatch().catch(workspaceError));
