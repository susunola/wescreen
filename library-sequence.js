// Incremental all-library merge: one original part is staged at a time.
const sequenceMergeButton=document.createElement('button');sequenceMergeButton.id='library-merge-all';sequenceMergeButton.type='button';sequenceMergeButton.className='quiet';sequenceMergeButton.textContent=E('合并全部录像（省空间）','Merge all recordings (space saving)');$('library-status').before(sequenceMergeButton);
window.addEventListener('wescreen-language',()=>{sequenceMergeButton.textContent=E('合并全部录像（省空间）','Merge all recordings (space saving)');});
let sequenceMergeRunning=false;
async function mergeEntireLibrary(){
 if(sequenceMergeRunning)return;
 if(!await privacy.request())return;
 return navigator.locks.request('wescreen-merge-submit',{ifAvailable:true},async lock=>{
  if(!lock)throw new Error(E('另一项合并正在准备中','Another merge is being prepared'));
  sequenceMergeRunning=true;sequenceMergeButton.disabled=true;let job;
  try{
   await stopSmartBackground();const health=await connectHelper();
   if(!health?.sequenceMerge)throw new Error(E('请更新并启动支持逐段压缩的本机程序','Start the helper with incremental merge support'));
   const saved=(await readStore('tasks')).filter(t=>t.sequence&&t.sequenceParts).sort((a,b)=>b.createdAt-a.createdAt);
   let parts;
   for(const task of saved){const response=await enhancementRequest('/jobs/'+task.id).catch(()=>null);const info=response?await response.json():null;if(info?.sequence&&['processing','error','cancelled'].includes(info.state)){job={...task,...info};parts=task.sequenceParts;if(info.state!=='processing')await enhancementRequest(`/sequence/${job.id}/resume`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({duration:parts.reduce((sum,p)=>sum+p.duration/1000,0)})});break;}}
   if(!job){
    const records=(await readStore('recordings')).filter(e=>!e.deletedAt);
    records.sort((a,b)=>(a.createdAt||0)-(b.createdAt||0)||(a.part||0)-(b.part||0)||String(a.id).localeCompare(String(b.id)));
    if(records.length<2)throw new Error(E('至少需要两个视频','At least two videos are required'));
    parts=records.map(r=>({id:r.id,duration:r.duration||0,name:r.name}));
    const duration=parts.reduce((sum,p)=>sum+p.duration/1000,0);
    const response=await(await enhancementRequest('/sequence',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({count:parts.length,duration})})).json();
    job={id:response.id,sequence:true,sequenceParts:parts,name:E('全部录像合并.mp4','All recordings merged.mp4'),mode:'merge',compress:true,state:'processing',createdAt:Date.now()};
    await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put(job));
   }
   navigateWorkspace('tasks');await renderEnhancementTasks();
   const pause=()=>new Promise(resolve=>setTimeout(resolve,1500));
   while(true){
    const info=await(await enhancementRequest('/jobs/'+job.id)).json();
    if(['done','error','cancelled'].includes(info.state)){if(info.state!=='done')throw new Error(info.error||'Merge stopped');break;}
    $('tasks-status').textContent=E('全部录像合并：已压缩 ','All recordings: compressed ')+(info.receivedParts||0)+' / '+parts.length+E(' 段。请保持此页面打开。',' parts. Keep this page open.');
    if(info.stage==='waiting-next-part'){
     const index=info.receivedParts||0;
     if(index===parts.length){await enhancementRequest(`/sequence/${job.id}/finish`,{method:'POST',body:''});}
     else{const blob=await readStore('videos',parts[index].id);if(!blob)throw new Error(E('录像分段缺失，已停止合并','Recording part is missing; merge stopped'));try{await enhancementRequest(`/sequence/${job.id}/part/${index}`,{method:'POST',body:blob});}catch(error){if(!/busy/i.test(error.message))throw error;}}
    }
    await pause();
   }
   $('tasks-status').textContent=E('全部录像已压缩合并完成，原录像保留。请导出结果。','All recordings merged and compressed; originals retained. Export the result.');await renderEnhancementTasks();
  }finally{sequenceMergeRunning=false;sequenceMergeButton.disabled=false;}
 });
}
sequenceMergeButton.onclick=()=>mergeEntireLibrary().catch(error=>{$('tasks-status').textContent=error.message;$('library-status').textContent=error.message;});
