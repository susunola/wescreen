const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
let chromium;try{({chromium}=require('playwright'));}catch{}
const root=path.resolve(__dirname,'..');
function mockExtension(){
  const values=()=>JSON.parse(localStorage.getItem('extension-test-storage') || '{"lang":"zh"}');const local={get:async()=>values(),set:async data=>localStorage.setItem('extension-test-storage',JSON.stringify({...values(),...data})),remove:async keys=>{const state=values();for(const key of [].concat(keys))delete state[key];localStorage.setItem('extension-test-storage',JSON.stringify(state));}};
  window.chrome={storage:{local,session:{get:async()=>({enhancementToken:'browser-test-token'}),set:async()=>{},remove:async()=>{}}},runtime:{onMessage:{addListener(){}},sendMessage:async()=>{}},downloads:{download:async options=>{window.lastDownload=options;return 1;},search:async()=>[{id:1,filename:'/Downloads/audit.mp4',state:'complete',exists:true}],show:async id=>window.shownDownload=id}};
}
async function harness(run){
  const server=http.createServer((req,res)=>{const file=path.join(root,new URL(req.url,'http://localhost').pathname==='/'?'recorder.html':new URL(req.url,'http://localhost').pathname);try{res.setHeader('Content-Type',file.endsWith('.js')?'text/javascript':file.endsWith('.css')?'text/css':file.endsWith('.html')?'text/html':'image/png');res.end(fs.readFileSync(file));}catch{res.statusCode=404;res.end();}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const browser=await chromium.launch({headless:true});const context=await browser.newContext();await context.addInitScript(mockExtension);
  try{await run(context,`http://127.0.0.1:${server.address().port}/recorder.html`);}finally{await browser.close();await new Promise(resolve=>server.close(resolve));}
}
async function pageReady(context,url){const p=await context.newPage();p.setDefaultTimeout(10000);await p.goto(url);await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');return p;}
async function capture(page,camera=false){
  await page.evaluate(async camera=>{
    $('capture-method').value='shared';$('preflight-enabled').checked=false;$('countdown').value='0';$('format').value='mp4';$('clicks').checked=false;$('camera').checked=camera;
    window.frameTimers={};function frames(color){const canvas=new OffscreenCanvas(320,180),paint=canvas.getContext('2d'),track=new MediaStreamTrackGenerator({kind:'video'}),writer=track.writable.getWriter();let n=0,busy=false;const interval=setInterval(async()=>{if(busy || track.readyState!=='live'){if(track.readyState!=='live')clearInterval(interval);return;}busy=true;const frame=new VideoFrame(canvas,{timestamp:Math.round(performance.now()*1000)});try{paint.fillStyle=color==='#b32' && n%20<10 ? '#226899' : color;paint.fillRect(0,0,320,180);paint.fillStyle='white';paint.fillText(String(n++),10,20);await writer.write(frame);}catch{}finally{frame.close();busy=false;}},33);window.frameTimers[color]=interval;return new MediaStream([track]);}
    const video=frames('#174');const audio=new AudioContext(),osc=audio.createOscillator(),output=audio.createMediaStreamDestination();osc.connect(output);osc.start();await audio.resume();window.syntheticAudio=audio;
    navigator.mediaDevices.getDisplayMedia=async()=>new MediaStream([...video.getVideoTracks(),...output.stream.getAudioTracks()]);
    if(camera){navigator.mediaDevices.getUserMedia=async()=>frames('#b32');window.requestAnimationFrame=()=>{throw new Error('Visible-document compositor must not be used');};}
    await start();
  },camera);
  await page.waitForFunction(()=>recorder?.state==='recording');
}
// Poll asynchronous storage predicates explicitly; never treat a Promise object as readiness.
async function waitForStorage(page,predicate,timeout=15000){const deadline=Date.now()+timeout;while(Date.now()<deadline){if(await page.evaluate(predicate))return;await new Promise(resolve=>setTimeout(resolve,50));}throw new Error('Storage predicate did not become true');}
async function stopCapture(page){await page.evaluate(()=>stop());await page.waitForFunction(()=>!recorder && finalId);}
const options={skip:!chromium};
test('stale recovery never overwrites a completed recording, and new starts reread authoritative state',options,async()=>harness(async(cx,url)=>{
  const a=await pageReady(cx,url);await capture(a);await a.waitForTimeout(2200);const b=await pageReady(cx,url);await b.waitForFunction(()=>!$('recovery').classList.contains('hidden'));
  await b.locator('#recover').click();await b.waitForFunction(()=>$('notice').textContent.includes('另一个'));assert.match(await b.locator('#notice').textContent(),/另一个/);
  await a.waitForTimeout(1000);await stopCapture(a);const before=await a.evaluate(async()=>{const e=(await readStore('recordings'))[0];return {id:e.id,size:e.size,duration:e.duration};});
  await b.locator('#recover').click();await b.waitForFunction(()=>$('recovery').classList.contains('hidden'));
  const after=await b.evaluate(async()=>{const e=(await readStore('recordings'))[0];return {id:e.id,size:e.size,duration:e.duration};});assert.deepEqual(after,before);assert.ok(before.duration>2500);
  await b.evaluate(async()=>{const e=(await readStore('recordings'))[0];const blob=await readStore('videos',e.id);await runTx(['chunks','meta'],'readwrite',tx=>{tx.objectStore('chunks').put(blob,'legacy-000000');tx.objectStore('meta').put({session:'legacy',name:'recovered.mp4',mimeType:'video/mp4'},'inProgress');});});
  // A's recovery UI is stale/hidden: start must still refuse unresolved data.
  await a.evaluate(()=>start());assert.match(await a.locator('#notice').textContent(),/恢复/);await a.evaluate(()=>{window.recoverySteps=[];const update=updateRecoveryProgress;updateRecoveryProgress=(done,total)=>{recoverySteps.push({done,total});return update(done,total);};});await a.locator('#recover').click();await waitForStorage(a,async()=>(await readStore('recordings')).length===2);await a.waitForFunction(()=>/已恢复|Restored safely/.test($('recovery-status').textContent));assert.ok(await a.evaluate(()=>recoverySteps.some(step=>step.done===step.total&&step.total>0)));assert.equal(await a.locator('#recovery-progress').isVisible(),false);
  await a.evaluate(()=>navigateWorkspace('library'));await a.getByRole('button',{name:'打开播放',exact:true}).first().click();await a.waitForFunction(()=>$('preview').readyState>=2);
}));
test('slow archival never delays the next encoder; stop during rollover keeps every completed part',options,async()=>harness(async(cx,url)=>{
  const page=await pageReady(cx,url);await capture(page);await page.waitForTimeout(1100);
  const timings=await page.evaluate(async()=>{const old=recorder;window.events=[];old.addEventListener('stop',()=>events.push({name:'old-stop',time:performance.now()}));const original=archiveRecording;archiveRecording=async(...args)=>{await new Promise(r=>setTimeout(r,1200));return original(...args);};await saveSegmentAndContinue();events.unshift({name:'next-active',time:performance.now(),state:recorder.state,oldState:old.state});return events;});
  assert.equal(timings[0].state,'recording');assert.equal(timings[0].oldState,'inactive');await page.waitForTimeout(1500);assert.equal(await page.evaluate(()=>recorder.state),'recording');await stopCapture(page);assert.equal(await page.evaluate(async()=>(await readStore('recordings')).length),2);
  await page.evaluate(async()=>{const all=await readStore('recordings');window.partData=await Promise.all(all.map(async e=>{const b=await readStore('videos',e.id);const v=document.createElement('video');v.muted=true;v.src=URL.createObjectURL(b);await new Promise((r,j)=>{v.onloadeddata=r;v.onerror=j;});return {size:b.size,duration:e.duration};}));});assert.equal((await page.evaluate(()=>partData)).every(e=>e.size>0 && e.duration>0),true);
  await capture(page);await page.waitForTimeout(1100);await page.evaluate(async()=>{window.rollingTest=saveSegmentAndContinue();stop();await rollingTest;});await page.waitForFunction(()=>!recorder);assert.equal(await page.evaluate(async()=>(await pendingSessions()).length),0);
}));
test('worker picture-in-picture records moving video without requestAnimationFrame',options,async()=>harness(async(cx,url)=>{
  const p=await pageReady(cx,url);await capture(p,true);const another=await cx.newPage();await another.goto('about:blank');await p.evaluate(()=>clearInterval(frameTimers['#174']));await p.waitForTimeout(6000);assert.equal(await p.evaluate(()=>recorder.state),'recording');await stopCapture(p);await p.waitForFunction(()=>$('preview').readyState>=2);assert.equal(await p.evaluate(()=>$('preview').videoWidth),320);
}));
test('library rename/course consistency, trash restore, permanent deletion, import and narrow layout',options,async()=>harness(async(cx,url)=>{
  const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);await p.evaluate(async()=>{const e=(await readStore('recordings'))[0];await updateRecording(e.id,{course:'Course A'});await renderRecordingLibrary();navigateWorkspace('library');});
  await p.locator('.row-menu summary').click();p.once('dialog',d=>d.accept('Renamed'));await p.getByRole('button',{name:'重命名',exact:true}).click();await p.waitForFunction(()=>$('course-items').textContent.includes('Renamed.mp4'));
  await p.locator('.row-menu summary').click();await p.getByRole('button',{name:'删除',exact:true}).click();await p.waitForFunction(()=>$('recording-items').children.length===0);assert.equal(await p.evaluate(()=>$('course-items').children.length),0);assert.equal(await p.evaluate(async()=>(await readStore('videos')).length),1);
  await p.locator('#library-trash').click();await p.getByRole('button',{name:'还原',exact:true}).last().click();await p.locator('#library-trash').click();await p.waitForFunction(()=>$('recording-items').children.length===1);
  const blob=await p.evaluate(async()=>{const e=(await readStore('recordings'))[0];return Array.from(new Uint8Array(await(await readStore('videos',e.id)).arrayBuffer()));});await p.locator('#import-video').setInputFiles({name:'imported.mp4',mimeType:'video/mp4',buffer:Buffer.from(blob)});await p.waitForFunction(()=>$('recording-items').children.length===2);
  await p.locator('#select-all').check();await p.locator('#bulk-delete').click();await p.locator('#library-trash').click();await p.locator('#select-all').check();p.once('dialog',d=>d.accept());await p.locator('#bulk-delete').click();await waitForStorage(p,async()=>(await readStore('videos')).length===0);
  await p.setViewportSize({width:390,height:844});assert.equal(await p.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
}));
test('retained completed results survive quota failure and export or save once after reload',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);
 const source=await p.evaluate(async()=>(await readStore('recordings'))[0]);
 const payload=Buffer.from(await p.evaluate(async()=>Array.from(new Uint8Array(await finalBlob.arrayBuffer()))));
 const task={id:'retained-result',state:'done',sourceId:source.id,name:source.name,mode:'edit',duration:1.2,width:320,height:180,size:payload.length,createdAt:Date.now()};let deletions=0;
 await cx.route('http://127.0.0.1:8765/**',async route=>{const req=route.request(),parts=new URL(req.url()).pathname.split('/').filter(Boolean);let body;
 if(req.method()==='DELETE'){deletions++;body={ok:true};}
 else if(parts[0]==='health')body={ready:true,ai:true};
 else if(parts[2]==='result'){await route.fulfill({contentType:'video/mp4',body:payload});return;}
 else if(parts[2]==='export')body={url:'http://127.0.0.1:8765/jobs/retained-result/result?ticket=temporary-ticket'};
 else body=parts.length===1?{jobs:[task]}:task;await route.fulfill({json:body});});
 await p.evaluate(async task=>{await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put(task));const original=IDBDatabase.prototype.transaction;IDBDatabase.prototype.transaction=function(names,...args){if(Array.isArray(names)&&names.includes('recordings')&&names.includes('tasks'))throw new DOMException('Injected quota failure','QuotaExceededError');return original.call(this,names,...args);};},task);
 assert.equal(await p.evaluate(async task=>{try{await saveTaskResult(task);return 'unexpected';}catch(e){return e.name;}},task),'QuotaExceededError');assert.equal(deletions,0);
 await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');await p.evaluate(()=>navigateWorkspace('tasks'));await p.getByRole('button',{name:'直接导出 MP4',exact:true}).click();await p.waitForFunction(()=>window.lastDownload?.url?.includes('ticket='));assert.doesNotMatch(await p.evaluate(()=>lastDownload.url),/browser-test-token/);
 const b=await pageReady(cx,url);await Promise.all([p.evaluate(task=>saveTaskResult(task),task),b.evaluate(task=>saveTaskResult(task),task)]);assert.equal(await p.evaluate(async()=>(await readStore('recordings')).length),2);assert.equal(deletions,0);
}));
test('blocked database upgrade reports a recoverable error instead of hanging silently',options,async()=>harness(async(cx,url)=>{
  const hold=await cx.newPage();await hold.goto(url.replace('recorder.html','popup.html'));await hold.evaluate(async()=>{window.held=await new Promise(resolve=>{const req=indexedDB.open('wescreen',3);req.onupgradeneeded=()=>{for(const name of ['meta','chunks','videos'])req.result.createObjectStore(name);req.result.createObjectStore('recordings',{keyPath:'id'});};req.onsuccess=()=>resolve(req.result);});});
  const p=await cx.newPage();await p.goto(url);await p.waitForFunction(()=>$('notice').textContent.includes('Database upgrade blocked'));await hold.evaluate(()=>held.close());await p.reload();await p.waitForFunction(()=>$('library-empty').textContent);
}));

test('memory-triggered automatic rotation keeps capture active without a total-library cap',options,async()=>harness(async(cx,url)=>{
  const p=await pageReady(cx,url);await capture(p);await p.evaluate(()=>{activeSegment.bytes=AUTO_SEGMENT_BYTES;});await p.waitForFunction(()=>activeSegment.index===2,{},{timeout:12000});assert.equal(await p.evaluate(()=>recorder.state),'recording');await p.waitForTimeout(1200);await stopCapture(p);assert.equal(await p.evaluate(async()=>(await readStore('recordings')).length),2);
}));

test('real local helper edit frontend integration and completed-result retention',options,async()=>{
  const {spawn}=require('node:child_process'),os=require('node:os');const work=fs.mkdtempSync(path.join(os.tmpdir(),'wescreen-helper-test-'));
  const python=path.join(root,'enhancement/.venv/bin/python');if(!fs.existsSync(python))return;
  let child,port;
  async function startHelper(){
    child=spawn(python,[path.join(root,'enhancement/server.py')],{env:{...process.env,WESCREEN_PORT:'0',WESCREEN_WORK_DIR:work,WESCREEN_ENHANCE_TOKEN:'browser-test-token'},stdio:['ignore','pipe','pipe']});
    port=await new Promise((resolve,reject)=>{let out='';const timeout=setTimeout(()=>reject(new Error('Helper startup timeout')),10000);child.stdout.on('data',chunk=>{out+=chunk;const m=out.match(/Local enhancer: http:\/\/127\.0\.0\.1:(\d+)/);if(m){clearTimeout(timeout);resolve(Number(m[1]));}});child.on('error',reject);child.on('exit',code=>{if(code){clearTimeout(timeout);reject(new Error('Helper exited '+code));}});});
  }
  async function stopHelper(){if(child && child.exitCode===null){const closed=new Promise(resolve=>child.once('exit',resolve));child.kill('SIGINT');await closed;}}
  try{await startHelper();await harness(async(cx,url)=>{
    await cx.route('http://127.0.0.1:8765/**',async route=>{const response=await route.fetch({url:route.request().url().replace(':8765',':'+port)});await route.fulfill({response});});
    const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(2200);await stopCapture(p);await p.evaluate(async()=>openVideoEditor((await readStore('recordings')).find(e=>!e.enhancedFrom)));await p.waitForFunction(()=>editorSize?.width>0);await p.locator('#edit-start').fill('0.2');await p.locator('#edit-end').fill('1.0');await p.locator('#crop-x').fill('16');await p.locator('#crop-y').fill('16');await p.locator('#crop-width').fill('200');await p.locator('#crop-height').fill('100');await p.locator('[data-rotate="90"]').click();await p.locator('#edit-save').click();await p.waitForFunction(()=>!editorSubmitting);
    const edited=await p.evaluate(async()=>(await readStore('recordings')).find(e=>e.enhancement==='edit'));assert.ok(edited);assert.equal(edited.width,100);assert.equal(edited.height,200);assert.ok(Math.abs(edited.duration-800)<130);
    const count=await p.evaluate(async()=>(await(await enhancementRequest('/jobs')).json()).jobs.length);assert.equal(count,1);await stopHelper();await startHelper();await p.reload();await p.waitForFunction(()=>$('library-empty').textContent);await p.evaluate(()=>navigateWorkspace('tasks'));await p.waitForFunction(()=>$('task-items').children.length===1);assert.equal(await p.evaluate(async()=>(await(await enhancementRequest('/jobs')).json()).jobs.every(j=>j.state==='done')),true);
  });}finally{await stopHelper();fs.rmSync(work,{recursive:true,force:true});}
});


test('actual unfinished MP4 chunks remain playable after the recording page closes',options,async()=>harness(async(cx,url)=>{
  const a=await pageReady(cx,url);await capture(a);await waitForStorage(a,async()=>(await loadChunks(activeSegment.session)).length>0);const b=await pageReady(cx,url);await a.close();await b.locator('#recover').click();await waitForStorage(b,async()=>(await readStore('recordings')).length===1);await b.evaluate(async()=>playRecording((await readStore('recordings'))[0]));await b.waitForFunction(()=>$('preview').readyState>=2);assert.ok(await b.evaluate(()=>finalBlob.size)>0);
}));
test('Telegram channel plans persist, recordings advance only their channel and export into its folder',options,async()=>harness(async(cx,url)=>{
  const p=await pageReady(cx,url);
  await p.evaluate(()=>{$('capture-mode').value='telegram';applyCapturePreset();$('channel-name').value='Channel A';$('channel-url').value='https://t.me/channel_a';$('channel-episode').value='7';$('channel-plan').value='Video One | https://t.me/channel_a/10\nVideo Two | https://t.me/channel_a/11';});
  await p.locator('#channel-save-plan').evaluate(button=>$('channel-plan-dialog').showModal());await p.locator('#channel-save-plan').click();await waitForStorage(p,async()=>(await readStore('meta')).some(e=>e?.channelProfile && e.plan.length===2));
  const id=await p.evaluate(()=>chosenChannel().id);await p.evaluate(()=>{selectNextChannelVideo();});
  await capture(p);await p.waitForTimeout(1200);await stopCapture(p);
  await waitForStorage(p,async()=>(await readStore('meta')).some(e=>e?.channelProfile && e.nextEpisode===8));
  const entry=await p.evaluate(async()=>(await readStore('recordings'))[0]);assert.equal(entry.channelId,id);assert.equal(entry.episode,7);assert.equal(entry.sourceUrl,'https://t.me/channel_a/10');assert.equal(entry.sourceTitle,'Video One');
  await p.locator('#result-play').click();assert.equal(await p.locator('#player-view').isVisible(),true);await p.locator('#download').click();await p.waitForFunction(()=>window.lastDownload?.filename?.startsWith('WeScreen/Telegram/Channel A/'));assert.equal(await p.locator('#channel-video-title').inputValue(),'Video Two');
  await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');await p.evaluate(id=>loadTelegramProfiles(id),id);assert.equal(await p.evaluate(()=>chosenChannel().plan.length),2);
  await p.evaluate(()=>{$('capture-mode').value='general';applyCapturePreset();});await capture(p);await p.waitForTimeout(1200);await stopCapture(p);const entries=await p.evaluate(()=>readStore('recordings'));assert.equal(entries.filter(e=>e.channelId===id).length,1);
}));
test('channel switch and reload preserve selection; invalid plans keep input and library failures stay visible',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);
 const ids=await p.evaluate(async()=>{for(const [id,name] of [['a','Channel A'],['b','Channel B']])await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({id,name,channelProfile:true,nextEpisode:1,exportFolder:'',plan:[{id:id+'-task',title:name+' Video',url:'https://t.me/'+id+'/1'}]},'channel:'+id));$('capture-mode').value='telegram';applyCapturePreset();await loadTelegramProfiles('a');return ['a','b'];});
 await p.locator('#channel-select').selectOption(ids[1]);await p.waitForFunction(()=>$('channel-video-title').value==='Channel B Video');await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');assert.equal(await p.locator('#channel-select').inputValue(),'b');assert.equal(await p.locator('#channel-video-title').inputValue(),'Channel B Video');
 await p.locator('#channel-plan').evaluate(input=>{$('channel-plan-dialog').showModal();input.value='invalid draft without link';});await p.locator('#channel-save-plan').click();assert.equal(await p.locator('#channel-plan').inputValue(),'invalid draft without link');assert.equal(await p.evaluate(()=>chosenChannel().plan.length),1);await p.locator('#channel-plan-close').click();
 await p.evaluate(()=>{navigateWorkspace('library');librarySelection.add('missing');updateLibrarySelection();removeRecordings=async()=>{throw new Error('Injected removal failure');};});await p.locator('#bulk-delete').click();await p.waitForFunction(()=>$('library-status').textContent.includes('Injected removal failure'));assert.equal(await p.locator('#library-status').isVisible(),true);
}));
test('offline helper does not label retained tasks as lost',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await cx.route('http://127.0.0.1:8765/**',route=>route.abort());await p.evaluate(async()=>{await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put({id:'retained-job',name:'Retained',state:'done',mode:'natural',createdAt:Date.now()}));navigateWorkspace('tasks');});await p.waitForFunction(()=>$('task-items').textContent.includes('Retained'));assert.match(await p.locator('#tasks-status').textContent(),/断开|未连接|连接/);assert.doesNotMatch(await p.locator('#task-items').textContent(),/任务已不存在|任务不存在|重新处理/);
}));
test('portrait rotation controls preview swapped dimensions and channel workbench supports skip/reorder',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);await p.evaluate(async()=>openVideoEditor((await readStore('recordings'))[0]));await p.waitForFunction(()=>editorSize && $('rotation-preview').width>0);await p.locator('[data-rotate="90"]').click();assert.equal(await p.locator('#edit-rotation').inputValue(),'90');assert.deepEqual(await p.evaluate(()=>[$('rotation-preview').width,$('rotation-preview').height]),[180,320]);await p.locator('#edit-close').click();
 await p.evaluate(async()=>{await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({id:'workbench',name:'Test Channel',channelProfile:true,nextEpisode:1,plan:[{id:'one',title:'One',url:'https://t.me/test/1'},{id:'two',title:'Two',url:'https://t.me/test/2'}]},'channel:workbench'));await loadTelegramProfiles('workbench');navigateWorkspace('channels');});await p.waitForFunction(()=>$('channel-plan-rows').children.length===2);await p.locator('#channel-plan-rows li').first().locator('.row-menu summary').click();await p.locator('#channel-plan-rows li').first().getByRole('button',{name:'跳过',exact:true}).click();await p.waitForFunction(()=>$('channel-plan-rows').textContent.includes('已跳过'));await p.locator('#channel-plan-rows li').last().locator('.row-menu summary').click();await p.locator('#channel-plan-rows li').last().getByRole('button',{name:'上移',exact:true}).click();await waitForStorage(p,async()=>(await readStore('meta','channel:workbench')).plan[0].id==='two');await p.locator('#channel-start').click();assert.equal(await p.locator('#capture-mode').inputValue(),'telegram');assert.equal(await p.locator('#setup').isVisible(),true);
}));
test('legacy restoration routes to Smart best while offline queue remains retained and inactive',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);
 await p.evaluate(async()=>{const source=(await readStore('recordings'))[0];await batchUpdate({id:'legacy-waiting',batchItem:true,sourceId:source.id,name:source.name,mode:'natural',state:'waiting',createdAt:Date.now()},{});await runBatch();await enqueueBatch();});
 assert.equal(await p.evaluate(async()=>(await batchItems())[0].state),'waiting');
 await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 const result=await p.evaluate(async()=>{window.smartStarts=0;realtimeButton.onclick=async()=>{smartStarts++;};await openEnhancement((await readStore('recordings'))[0]);return {starts:smartStarts,workspace:workspaceView,offlineDialog:$('enhance-panel').open,queueHidden:$('batch-queue-panel').hidden,items:(await batchItems()).length};});
 assert.deepEqual(result,{starts:1,workspace:'player',offlineDialog:false,queueHidden:true,items:1});
}));
test('source preflight cancels without recording; recording review shows three frames',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d');window.preflightFrames=setInterval(()=>{ctx.fillStyle='blue';ctx.fillRect(0,0,320,180);},33);navigator.mediaDevices.getDisplayMedia=async()=>canvas.captureStream(30);$('countdown').value='0';$('clicks').checked=false;$('preflight-enabled').checked=true;window.pendingStart=start();});await p.waitForFunction(()=>$('preflight-panel').open);await p.locator('#preflight-cancel').click();await p.evaluate(()=>pendingStart);assert.equal(await p.evaluate(()=>recorder),null);assert.equal(await p.evaluate(async()=>(await pendingSessions()).length),0);
 await capture(p);await p.waitForTimeout(1300);await stopCapture(p);await p.waitForFunction(()=>$('review-frames').children.length===3);assert.match(await p.locator('#review-summary').textContent(),/已存入/);
}));
test('channel next-video retains shared capture and saves separate named recordings',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>{$('capture-mode').value='telegram';applyCapturePreset();$('channel-name').value='Continuous';$('channel-plan').value='First | https://t.me/test/1\nSecond | https://t.me/test/2';$('channel-plan-dialog').showModal();});await p.locator('#channel-save-plan').click();await waitForStorage(p,async()=>(await readStore('meta')).some(e=>e.channelProfile && e.plan.length===2));await capture(p);await p.waitForTimeout(1200);await p.locator('.recording-secondary > summary').click();await p.locator('#next-channel-video').click();await p.waitForFunction(()=>activeSegment?.awaitingNext && !advancingChannel);assert.equal(await p.evaluate(()=>recorder.state),'paused');assert.equal(await p.evaluate(()=>displayStream.getVideoTracks()[0].readyState),'live');assert.equal(await p.locator('#channel-video-title').inputValue(),'Second');await p.evaluate(()=>pause());await p.waitForTimeout(1200);await stopCapture(p);const entries=await p.evaluate(()=>readStore('recordings'));assert.equal(entries.length,2);assert.equal(entries[0].channelTaskId===entries[1].channelTaskId,false);assert.ok(entries.every(e=>e.duration>800));
}));

test('stopping between channel videos discards the unstarted next recording',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>{$('capture-mode').value='telegram';applyCapturePreset();$('channel-name').value='Stop Between';$('channel-message-url').value='https://t.me/test/3';});await capture(p);await p.waitForTimeout(1200);await p.locator('.recording-secondary > summary').click();await p.locator('#next-channel-video').click();await p.waitForFunction(()=>activeSegment?.awaitingNext && !advancingChannel);await p.locator('#stop').click();await waitForStorage(p,async()=>(await pendingSessions()).length===0);assert.equal(await p.evaluate(async()=>(await readStore('recordings')).length),1);assert.equal(await p.locator('#setup').isVisible(),true);
}));
test('channel edit preferences restore for matching dimensions and bright clips are not trimmed',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1400);await stopCapture(p);await p.evaluate(async()=>{const entry=(await readStore('recordings'))[0];entry.channelId='pref-test';await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({channelProfile:true,id:'pref-test',cropPreference:{crop:[10,10,200,100],width:320,height:180,rotation:90,landscape:true}},'channel:pref-test'));await openVideoEditor(entry);});await p.waitForFunction(()=>$('edit-rotation').value==='90');assert.equal(await p.locator('#edit-landscape').isChecked(),true);assert.equal(await p.locator('#crop-width').inputValue(),'200');await p.locator('#suggest-trim').click();await p.waitForFunction(()=>!$('suggest-trim').disabled);assert.equal(await p.locator('#apply-trim').isDisabled(),true);assert.ok(await p.evaluate(()=>trimSuggestion?.start===0));
}));
test('black-screen suggestions require manual application and preserve the original',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d'),began=performance.now();window.blackFrames=setInterval(()=>{const t=performance.now()-began;ctx.fillStyle=t<650 || t>2700?'black':'blue';ctx.fillRect(0,0,320,180);},33);navigator.mediaDevices.getDisplayMedia=async()=>canvas.captureStream(30);$('preflight-enabled').checked=false;$('countdown').value='0';$('screen-audio').checked=false;$('clicks').checked=false;await start();});await p.waitForTimeout(3400);await stopCapture(p);await p.evaluate(async()=>openVideoEditor((await readStore('recordings'))[0]));await p.waitForFunction(()=>$('edit-preview').readyState>=2);const originalEnd=await p.locator('#edit-end').inputValue();await p.locator('#suggest-trim').click();await p.waitForFunction(()=>!$('suggest-trim').disabled);assert.equal(await p.locator('#edit-start').inputValue(),'0');assert.equal(await p.locator('#edit-end').inputValue(),originalEnd);assert.equal(await p.locator('#apply-trim').isDisabled(),false);await p.locator('#apply-trim').click();assert.ok(Number(await p.locator('#edit-start').inputValue())>0);assert.ok(Number(await p.locator('#edit-end').inputValue())<Number(originalEnd));assert.equal(await p.evaluate(async()=>(await readStore('recordings')).length),1);
}));
test('saved MP4 contains changing frames while the recorder is in the background',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);const foreground=await cx.newPage();await foreground.goto('about:blank');await foreground.bringToFront();await p.waitForTimeout(3200);await stopCapture(p);const checks=await p.evaluate(async()=>{const v=$('preview');await v.play();v.pause();const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const ctx=canvas.getContext('2d'),images=[];for(const t of [.2,1.5,2.7]){await new Promise((resolve,reject)=>{const timeout=setTimeout(()=>reject(new Error('Decoded MP4 seek timeout')),5000);v.addEventListener('seeked',()=>{clearTimeout(timeout);resolve();},{once:true});v.currentTime=t;});ctx.drawImage(v,0,0,320,180);const data=ctx.getImageData(0,0,320,180).data;let hash=2166136261;for(const value of data)hash=Math.imul(hash^value,16777619);images.push(hash>>>0);}return images;});assert.equal(new Set(checks).size,3,'Recorded MP4 must contain three different decoded frames');
}));
test('direct-tab capture permission denial never starts another source',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>{$('capture-method').value='tab';chrome.permissions={request:async()=>false};navigator.mediaDevices.getDisplayMedia=async()=>{throw new Error('Unexpected sharing fallback');};});await p.locator('#start').click();await p.waitForFunction(()=>$('notice').textContent.includes('权限'));assert.equal(await p.evaluate(()=>recorder),null);assert.equal(await p.locator('#start').isDisabled(),false);assert.equal(await p.evaluate(async()=>(await pendingSessions()).length),0);
}));

test('playlist persists, resumes playback, groups parts and removes deleted entries across pages',options,async()=>harness(async(cx,url)=>{
  const p=await pageReady(cx,url),errors=[];p.on('pageerror',e=>errors.push(e.message));
  await capture(p);await p.waitForTimeout(1200);await stopCapture(p);await p.waitForFunction(()=>playbackReady);
  const first=await p.evaluate(()=>finalId);
  await p.evaluate(async first=>{const entry=await readStore('recordings',first),blob=await readStore('videos',first);await updateRecording(first,{recordingGroupId:'playlist-group',part:1});await runTx(['recordings','videos'],'readwrite',tx=>{for(const id of ['playlist-part2','playlist-other']){tx.objectStore('recordings').put({...entry,id,name:id+'.mp4',recordingGroupId:id==='playlist-part2'?'playlist-group':null,part:id==='playlist-part2'?2:1,createdAt:entry.createdAt+1000});tx.objectStore('videos').put(blob,id);}});await playRecording(await readStore('recordings','playlist-part2'));},first);
  await p.waitForFunction(()=>playbackReady);
  await p.evaluate(async()=>{$('preview').pause();$('preview').currentTime=.5;await savePlaybackState();await playRecording(await readStore('recordings','playlist-other'));await refreshPlayerPlaylist();});
  assert.equal(await p.locator('.player-playlist-item').count(),2);
  await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');await p.evaluate(()=>refreshPlayerPlaylist());assert.equal(await p.locator('.player-playlist-item').count(),2);
  await p.evaluate(async()=>{await playRecording(await readStore('recordings','playlist-other'));$('player-playlist-menu').open=true;});await p.waitForFunction(()=>playbackReady);await p.locator('.player-playlist-item').filter({hasText:'段连续播放'}).click();await p.waitForFunction(()=>playbackReady&&$('preview').currentTime>.4);assert.equal(await p.evaluate(()=>playbackParts.length),2);
  const other=await pageReady(cx,url);await other.evaluate(()=>removeRecordings(['playlist-other']));await p.waitForFunction(()=>document.querySelectorAll('.player-playlist-item').length===1);
  await other.evaluate(first=>removeRecordings([first]),first);await p.waitForFunction(()=>document.querySelectorAll('.player-playlist-item').length===0);
  assert.deepEqual(await p.evaluate(()=>readStore('meta','player-history')),[]);
  await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');await p.evaluate(()=>refreshPlayerPlaylist());assert.equal(await p.locator('.player-playlist-item').count(),0);assert.deepEqual(errors,[]);
}));


test('Telegram link-only setup groups by channel identity and preserves names and invalid drafts',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>navigateWorkspace('channels'));
 assert.equal(await p.locator('#channel-message-url').isVisible(),true);
 await p.locator('#channel-message-url').fill('https://t.me/c/1234567890/101');await p.locator('#channel-message-url').dispatchEvent('change');await p.waitForFunction(()=>chosenChannel()?.channelKey==='private:1234567890');
 const id=await p.evaluate(()=>chosenChannel().id);assert.equal(await p.locator('#channel-name').isVisible(),false);
 await p.locator('#channel-message-url').fill('https://t.me/c/1234567890/102');await p.locator('#channel-message-url').dispatchEvent('change');await p.waitForFunction(()=>$('channel-status').textContent.includes('102'));assert.equal(await p.evaluate(()=>chosenChannel().id),id);
 await p.locator('#channel-manage').click();await p.locator('#channel-name').fill('My saved channel');await p.locator('#channel-save').click();await p.waitForFunction(()=>chosenChannel()?.name==='My saved channel');
 await p.locator('#channel-message-url').fill('https://t.me/other_channel/102');await p.locator('#channel-message-url').dispatchEvent('change');await p.waitForFunction(()=>chosenChannel()?.channelKey==='public:other_channel');assert.notEqual(await p.evaluate(()=>chosenChannel().id),id);
 await p.locator('#channel-add-video').click();await p.locator('#channel-plan').fill('https://t.me/other_channel/102\nhttps://t.me/other_channel/103');await p.locator('#channel-save-plan').click();await p.waitForFunction(()=>chosenChannel()?.plan.length===2).catch(async error=>{console.log(await p.evaluate(()=>({status:$('channel-status').textContent,profile:chosenChannel(),draft:$('channel-plan').value,message:$('channel-message-url').value})));throw error;});assert.equal(await p.evaluate(()=>chosenChannel().plan[0].title),'视频 102');
 await p.locator('#channel-edit-plan').click();await p.locator('#channel-plan').fill('https://t.me/other_channel/102\nhttps://t.me/c/1234567890/103');await p.locator('#channel-save-plan').click();assert.equal(await p.evaluate(()=>chosenChannel().plan.length),2);assert.match(await p.locator('#channel-status').textContent(),/同一频道/);
}));

test('message takes stay distinct and crop worker follows normalized regions without stretching',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);
 const result=await p.evaluate(async()=>{
  const worker=new Worker('telegram-crop-worker.js');worker.onmessage=e=>{if(e.data.type==='error')console.error(e.data.message);};const input=new TransformStream(),output=new TransformStream(),writer=input.writable.getWriter(),reader=output.readable.getReader();
  worker.postMessage({screen:input.readable,output:output.writable,region:{x:0,y:0,width:.5,height:1}},[input.readable,output.writable]);
  const canvas=new OffscreenCanvas(200,100),ctx=canvas.getContext('2d');ctx.fillStyle='red';ctx.fillRect(0,0,100,100);ctx.fillStyle='blue';ctx.fillRect(100,0,100,100);
  async function frame(t){const inputFrame=new VideoFrame(canvas,{timestamp:t}),reading=reader.read();await writer.write(inputFrame);const {value}=await reading;if(!value)throw new Error('Crop output closed');const sample=new OffscreenCanvas(value.displayWidth,value.displayHeight),c=sample.getContext('2d');c.drawImage(value,0,0);const dimensions=[value.displayWidth,value.displayHeight],pixel=[...c.getImageData(50,50,1,1).data];value.close();return {dimensions,pixel};}
  const first=await frame(1);worker.postMessage({type:'region',region:{x:.5,y:0,width:.5,height:1}});await new Promise(r=>setTimeout(r,30));const second=await frame(2);worker.postMessage({type:'region',region:null});await new Promise(r=>setTimeout(r,30));const third=await frame(3);worker.terminate();await reader.cancel().catch(()=>{});await writer.abort().catch(()=>{});
  await runTx('recordings','readwrite',tx=>{for(const e of [{id:'take1',recordingGroupId:'session1'},{id:'take2',recordingGroupId:'session2'},{id:'repair',enhancedFrom:'take2'}])tx.objectStore('recordings').put({...e,sourceMessageKey:'private:123:101',name:e.id+'.mp4',size:100,duration:1000,createdAt:Date.now()});});$('library-group').checked=true;await renderRecordingLibrary();return {first,second,third,groups:recordingGroups(await readStore('recordings')).length,rows:[...$('recording-items').querySelectorAll('.media-row')].map(e=>e.dataset.recordingId),takes:[...$('recording-items').children].filter(e=>e.textContent.includes('重录版')).length};
 });assert.deepEqual(result.first.dimensions,[100,100]);assert.ok(result.first.pixel[0]>240);assert.ok(result.second.pixel[2]>240);assert.equal(result.third.pixel[0],0);assert.equal(result.groups,3);assert.equal(result.takes,1);assert.equal(result.rows.length,3);
}));

test('Telegram sample inspection saves advisory metadata and never changes the original bytes',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);
 const result=await p.evaluate(async()=>{const id=finalId,blob=await readStore('videos',id),hash=async b=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',await b.arrayBuffer()))].join(',');const before=await hash(blob);await updateRecording(id,{sourceMessageKey:'private:123:101',captureDiagnostics:{audioSamples:12,audioObserved:false,maxWriteAge:22}});await inspectTelegramRecording(id);const after=await hash(await readStore('videos',id)),entry=await readStore('recordings',id);return {before,after,inspection:entry.inspection};});assert.equal(result.before,result.after);assert.ok(result.inspection.samples>=2);assert.ok(result.inspection.warnings.some(w=>w.kind==='audio'));assert.ok(result.inspection.warnings.some(w=>w.kind==='write'));
}));
test('face restoration requires a matching preview and confirmation; changed parameters invalidate it',options,async()=>harness(async(cx,url)=>{
 const page=await pageReady(cx,url),errors=[];page.on('pageerror',error=>errors.push(error.message));
 await page.evaluate(()=>{
  enhancementSource={id:'face-test',name:'face-test.mp4'};helperHealth={face:true,ai:true,strong:true};$('enhance-panel').showModal();$('enhance-mode').value='face';updateEnhancementMode();
 });
 assert.equal(await page.locator('#enhance-face-controls').isVisible(),true);assert.equal(await page.locator('#enhance-preview').isEnabled(),true);assert.equal(await page.locator('#enhance-full').isDisabled(),true);
 await page.evaluate(()=>{facePreviewReceipt={id:'receipt',signature:faceSettingsSignature()};updateEnhancementMode();});
 await page.locator('#face-preview-confirm').check();assert.equal(await page.locator('#enhance-full').isEnabled(),true);
 await page.locator('#face-fidelity').fill('0.9');await page.locator('#face-fidelity').dispatchEvent('input');assert.equal(await page.locator('#enhance-full').isDisabled(),true);assert.equal(await page.locator('#face-preview-confirm').isChecked(),false);
 await page.evaluate(()=>{facePreviewReceipt={id:'receipt',signature:faceSettingsSignature()};faceConfirm.checked=true;enhancementSource={id:'different-source'};updateEnhancementMode();});assert.equal(await page.locator('#enhance-full').isDisabled(),true);
 await page.evaluate(()=>{helperHealth={ai:true,strong:true};updateEnhancementMode();});assert.equal(await page.locator('#enhance-preview').isDisabled(),true);assert.match(await page.locator('#enhance-mode-hint').textContent(),/install-face/);
 await page.evaluate(()=>{applyLang('en');});assert.match(await page.locator('#face-preview-confirm').locator('..').textContent(),/checked the preview/);assert.deepEqual(errors,[]);
}));


test('helper discovery owns status during task refresh and restores retry controls',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);let release;const gate=new Promise(resolve=>release=resolve);
 await cx.route('http://127.0.0.1:8765/**',async route=>{const path=new URL(route.request().url()).pathname;if(path==='/health'){await gate;await route.fulfill({json:{ready:true,ai:true}});}else await route.fulfill({json:{jobs:[]}});});
 await p.evaluate(()=>{window.pendingConnect=connectHelper();navigateWorkspace('tasks');});
 await p.waitForFunction(()=>$('tasks-connection').dataset.state==='connecting');await p.evaluate(()=>renderEnhancementTasks());
 assert.equal(await p.locator('#tasks-connect').isVisible(),true);assert.equal(await p.locator('#tasks-connect').isDisabled(),true);assert.match(await p.locator('#tasks-status').textContent(),/连接/);
 release();await p.evaluate(()=>window.pendingConnect);assert.equal(await p.locator('#tasks-connection').getAttribute('data-state'),'connected');
 await cx.unroute('http://127.0.0.1:8765/**');await cx.route('http://127.0.0.1:8765/**',route=>route.abort());await p.evaluate(()=>connectHelper());assert.equal(await p.locator('#tasks-connection').getAttribute('data-state'),'offline');assert.equal(await p.locator('#tasks-connect').isVisible(),true);assert.equal(await p.locator('#tasks-connect').isDisabled(),false);
}));

test('user pairing retry follows a failed background discovery instead of being swallowed',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);
 await cx.route('http://127.0.0.1:8765/**',async route=>{const u=new URL(route.request().url());if(u.pathname==='/connect' && !u.searchParams.has('challenge')){await new Promise(resolve=>setTimeout(resolve,150));await route.fulfill({status:403,json:{error:'Helper is paired with another extension. Approve this extension in the local launcher.'}});}else await route.fulfill({json:u.pathname==='/connect'?{token:'new-approved-token-123456789'}:u.pathname==='/health'?{ready:true}: {jobs:[]}});});
 await p.evaluate(async()=>{chrome.runtime.id='a'.repeat(32);enhancementToken='';$('enhance-token').value='';window.externalStarts=0;HTMLAnchorElement.prototype.click=function(){if(this.href==='wescreen-helper://start')window.externalStarts++;};window.pairingPrompts=0;openNativePairing=()=>window.pairingPrompts++;const background=connectHelper();const user=connectHelper({repair:true,launch:true});await Promise.all([background,user]);});
 assert.equal(await p.evaluate(()=>window.externalStarts),0);assert.equal(await p.evaluate(()=>window.pairingPrompts),1);assert.equal(await p.locator('#tasks-connection').getAttribute('data-state'),'connected');assert.equal(await p.evaluate(()=>helperConnecting),null);
}));


test('late failed task poll cannot clear a newer healthy connection',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);let release;const gate=new Promise(resolve=>release=resolve);let jobsStarted;const started=new Promise(resolve=>jobsStarted=resolve);
 await cx.route('http://127.0.0.1:8765/**',async route=>{if(new URL(route.request().url()).pathname==='/jobs'){jobsStarted();await gate;await route.abort();}else await route.fulfill({json:{ready:true}});});
 await p.waitForFunction(()=>!taskPolling);await p.evaluate(()=>{window.taskPoll=renderEnhancementTasks();});await started;await p.evaluate(()=>connectHelper());release();await p.evaluate(()=>window.taskPoll);
 assert.equal(await p.evaluate(()=>helperHealth.ready),true);assert.equal(await p.locator('#tasks-connection').getAttribute('data-state'),'connected');assert.doesNotMatch(await p.locator('#tasks-status').textContent(),/未连接/);
}));

test('verified disk recordings persist a readable index across reloads without duplicate video blobs',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await capture(p);await p.waitForTimeout(1200);await stopCapture(p);
 const saved=await p.evaluate(async()=>{
   const folder=await navigator.storage.getDirectory();captureDirectory=folder;diskMode.value='file';
   const blob=finalBlob,state={name:'single-copy.webm',session:'disk-test',bytes:blob.size,details:{}};
   await writeDiskChunk(state,blob);await closeDiskSegment(state);
   await saveChunk(blob,'disk-test',0);
   const id=await archiveRecording(blob,'single-copy.webm','disk-test',1,false,state.details);
   const database=await db,raw=await new Promise((resolve,reject)=>{const r=database.transaction('videos').objectStore('videos').get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
   return {id,isBlob:raw instanceof Blob,index:raw.diskBacked,chunks:(await loadChunks('disk-test')).length,storage:(await readStore('recordings',id)).storageKind};
 });
 assert.equal(saved.isBlob,false);assert.equal(saved.index,true);assert.equal(saved.chunks,0);assert.equal(saved.storage,'disk');
 await p.reload();await p.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 assert.ok(await p.evaluate(async id=>(await readStore('videos',id)).size>100,saved.id));
 await p.evaluate(async()=>{const handle=await(await navigator.storage.getDirectory()).getFileHandle('single-copy-disk-test.webm'),writer=await handle.createWritable();await writer.write('changed');await writer.close();});
 assert.match(await p.evaluate(async id=>{try{await readStore('videos',id);return 'unexpected success';}catch(e){return e.message;}},saved.id),/录像文件已变化/);
}));

test('incomplete disk files fall back to a full library copy',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);const result=await p.evaluate(async()=>{
   const handle=await(await navigator.storage.getDirectory()).getFileHandle('incomplete.webm',{create:true});
   const blob=new Blob(['safe library fallback'],{type:'video/webm'});
   const id=await archiveRecording(blob,'fallback.webm','fallback-test',1,false,{diskStorage:'file',diskHandle:handle});
   return {storage:(await readStore('recordings',id)).storageKind,text:await(await readStore('videos',id)).text()};
 });assert.equal(result.storage,'browser');assert.equal(result.text,'safe library fallback');
}));

test('language changes refresh generated recording rows and filter labels',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(async()=>{await runTx('recordings','readwrite',tx=>tx.objectStore('recordings').put({id:'language-row',name:'Language demo.mp4',size:1234,duration:1000,createdAt:Date.now()}));await renderRecordingLibrary();navigateWorkspace('library');applyLang('en');});
 await p.waitForFunction(()=>document.querySelector('.recording-badge')?.textContent==='Original');
 assert.match(await p.locator('#library-total').textContent(),/recording/);
 await p.evaluate(()=>applyLang('zh'));await p.waitForFunction(()=>document.querySelector('.recording-badge')?.textContent==='原视频');
 assert.match(await p.locator('#library-total').textContent(),/条/);assert.match(await p.locator('#library-course option').first().textContent(),/全部/);
}));

test('same-size disk corruption preserves the browser recording and recovery until archive succeeds',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);const result=await p.evaluate(async()=>{
   captureDirectory=await navigator.storage.getDirectory();diskMode.value='file';const blob=new Blob(['original recording bytes'],{type:'application/octet-stream'}),state={name:'integrity.bin',session:'integrity-test',bytes:blob.size,details:{}};
   await saveChunk(blob,state.session,0);await writeDiskChunk(state,blob);
   const close=state.diskWriter.close.bind(state.diskWriter);state.diskWriter.close=async()=>{await close();const writer=await state.diskHandle.createWritable();await writer.write(new Uint8Array(blob.size).fill(4));await writer.close();};
   await closeDiskSegment(state);const before=(await loadChunks(state.session)).length;
   const id=await archiveRecording(blob,state.name,state.session,1,false,state.details);
   return {failed:state.diskFailed,recoveryBeforeArchive:before,text:await(await readStore('videos',id)).text(),kind:(await readStore('recordings',id)).storageKind||'browser'};
 });assert.equal(result.failed,true);assert.equal(result.recoveryBeforeArchive,1);assert.equal(result.kind,'browser');assert.equal(result.text,'original recording bytes');
}));

test('Smart best retries failed chunks with a limit and allows explicit retry',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);const result=await p.evaluate(async()=>{
   window.savedSmartRequest=enhancementRequest;enhancementRequest=async()=>new Response(JSON.stringify({state:'error',error:'synthetic failure'}));
   smartBackground.enabled=true;smartBackground.session='retry-session';smartBackground.total=1;
   for(let attempt=0;attempt<3;attempt++){smartBackground.pending=0;smartBackground.retryAt=0;await pumpSmartChunks();clearTimeout(smartBackground.poll);}
   const retries=smartBackground.retries.get(0),blocked=smartBackground.failed.has(0);updateSmartRetry();const visible=!smartRetryButton.hidden;
   enhancementRequest=async()=>new Response('{}');smartRetryButton.click();await new Promise(resolve=>setTimeout(resolve,20));const reset=!smartBackground.failed.has(0)&&!smartBackground.retries.has(0);await stopSmartBackground();enhancementRequest=window.savedSmartRequest;
   return {retries,blocked,visible,reset};
 });assert.deepEqual(result,{retries:3,blocked:true,visible:true,reset:true});
}));

test('safe diagnostics whitelist aggregate fields and recording presets apply explicit budgets',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await cx.route('http://127.0.0.1:8765/**',async route=>{const endpoint=new URL(route.request().url()).pathname;const values=endpoint==='/health'?{version:'test',smartNeural:true}:endpoint==='/storage'?{diskFree:1234,uploadsBytes:10,jobsBytes:20,activeJobs:0,path:'/private/media-name.mp4',token:'private-secret'}:{bytes:30,sourceBytes:40,limit:800,assets:1,activeSessions:0,path:'/private/cache'};await route.fulfill({json:values});});
 const result=await p.evaluate(async()=>{enhancementToken='private-secret';recordDiagnostic('disk-write-failed');recordDiagnostic('/private/forbidden.mp4');profileSelect.value='lecture';profileSelect.onchange();return {settings:['resolution','quality','framerate','capture-content','capture-audio-quality'].map(id=>$(id).value),report:await safeDiagnostics()};});
 assert.deepEqual(result.settings,['1080','compact','24','detail','128000']);assert.equal(result.report.helper.connected,true);assert.equal(result.report.helper.storage.uploadsBytes,10);assert.equal(result.report.events.length,1);assert.doesNotMatch(JSON.stringify(result.report),/private-secret|\/private\/|media-name/);
}));

test('repeated helper transport failures stop automatic polling instead of retrying indefinitely',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);const result=await p.evaluate(async()=>{
   const original=enhancementRequest;enhancementRequest=async()=>{throw new TypeError('Network unavailable');};smartBackground.enabled=true;smartBackground.session='transport-test';smartBackground.pending=0;smartBackground.total=1;
   for(let attempt=0;attempt<3;attempt++){await pumpSmartChunks();clearTimeout(smartBackground.poll);}
   const result={failures:smartBackground.transportFailures,pollStopped:smartBackground.poll===null,stage:smartBackground.stage};await stopSmartBackground();enhancementRequest=original;return result;
 });assert.deepEqual(result,{failures:3,pollStopped:true,stage:'error'});
}));

test('a failed recovery chunk write still retains the completed in-memory recording',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);await p.evaluate(()=>{const original=IDBObjectStore.prototype.put;let failed=false;IDBObjectStore.prototype.put=function(value,key){if(this.name==='chunks'&&!failed){failed=true;throw new DOMException('Injected recovery quota','QuotaExceededError');}return original.call(this,value,key);};});
 await capture(p);await p.waitForTimeout(1600);await stopCapture(p);
 const result=await p.evaluate(async()=>{const records=await readStore('recordings');const blob=await readStore('videos',records[0].id);return {count:records.length,size:blob.size,decodes:await recordingDecodes(blob)};});assert.equal(result.count,1);assert.ok(result.size>100);assert.equal(result.decodes,true);
}));

test('smart session heartbeat renews an expired lease while preserving playback intent',options,async()=>harness(async(cx,url)=>{
 const p=await pageReady(cx,url);const result=await p.evaluate(async()=>{
   const originalRequest=enhancementRequest,originalConnect=connectHelper,originalStart=startSmartBackground;let renewed=0;
   smartBackground.enabled=true;smartBackground.heartbeat=true;smartBackground.session='lease-test';smartBackground.resume=true;activePlaybackId=null;
   enhancementRequest=async()=>{throw new Error('Smart session expired');};connectHelper=async()=>({smartChunks:true,smartHeartbeat:true});startSmartBackground=async()=>{renewed++;smartBackground.resume=false;return true;};
   await keepSmartSession();const result={renewed,resume:smartBackground.resume};enhancementRequest=async()=>new Response('{}');await stopSmartBackground();enhancementRequest=originalRequest;connectHelper=originalConnect;startSmartBackground=originalStart;return result;
 });assert.deepEqual(result,{renewed:1,resume:true});
}));
