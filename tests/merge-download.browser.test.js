const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {chromium} = require('playwright');

test('continuous recording compresses in order and downloads once after completion, including across tabs', async () => {
  const root = process.env.WESCREEN_TEST_ROOT || path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const file = path.join(root, new URL(req.url, 'http://localhost').pathname);
    try {
      res.setHeader('Content-Type', file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.html') ? 'text/html' : 'image/png');
      res.end(fs.readFileSync(file));
    } catch { res.statusCode = 404; res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({headless:true});
  const context = await browser.newContext();
  await context.addInitScript(() => {
    window.chrome = {
      storage: {local: {get: async () => ({lang:'zh'}), set: async () => {}}, session:{get:async()=>({}),set:async()=>{}}},
      runtime: {onMessage:{addListener(){}},sendMessage:async()=>{}},
      downloads:{download:async options=>{window.downloadCalls ??= []; downloadCalls.push(options); return downloadCalls.length;}}
    };
  });
  try {
    const url = `http://127.0.0.1:${server.address().port}/recorder.html`;
    const a = await context.newPage();
    const errors=[];a.on('pageerror',error=>errors.push(error.message));
    await a.goto(url);await a.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    await a.evaluate(async () => {
      for(const part of [3,1,2]){
        const blob=new Blob([String(part)],{type:'video/mp4'});
        const entry={id:'part-'+part,name:part===1?'course.mp4':`course-part-00${part}.mp4`,recordingGroupId:'course',part,createdAt:part*1000,duration:1000,size:blob.size,width:320,height:180};
        await runTx(['recordings','videos'],'readwrite',tx=>{tx.objectStore('recordings').put(entry);tx.objectStore('videos').put(blob,entry.id);});
      }
      window.uploadedParts=[];window.remoteJobs=[];
      connectHelper=async()=>({merge:true,mergeCompression:true});
      enhancementToken='test-token';
      enhancementRequest=async (path,options={})=>{
        if(path==='/uploads'){uploadedParts.push(await options.body.text());return {json:async()=>({id:'upload-'+uploadedParts.length})};}
        if(path==='/jobs/merge'){window.mergeRequest=JSON.parse(options.body);remoteJobs=[{id:'merged-job',mode:'merge',name:'course.mp4',sourceId:'part-1',state:'processing',progress:.4,compress:true,createdAt:Date.now()}];return {json:async()=>({id:'merged-job'})};}
        if(path==='/jobs')return {json:async()=>({jobs:remoteJobs})};
        if(path.endsWith('/export'))return {json:async()=>({url:'http://127.0.0.1:8765/download/test-ticket'})};
        throw Error('Unexpected request '+path);
      };
      navigateWorkspace('library');await renderRecordingLibrary();
    });
    await a.getByRole('button',{name:'合并下载（自动压缩）',exact:true}).click();
    await a.waitForFunction(async()=>!!(await readStore('tasks','merged-job')));
    assert.deepEqual(await a.evaluate(()=>uploadedParts),['1','2','3']);
    assert.equal(await a.evaluate(()=>mergeRequest.compress),true);
    assert.equal(await a.evaluate(()=>downloadCalls?.length || 0).catch(()=>0),0);
    await a.evaluate(async()=>{remoteJobs[0].state='done';remoteJobs[0].size=4e9;await renderEnhancementTasks();await renderEnhancementTasks();});
    assert.equal(await a.evaluate(()=>downloadCalls.length),1);
    const download=await a.evaluate(()=>downloadCalls[0]);
    assert.match(download.filename,/merged-compressed-1080p\.mp4$/);assert.equal(download.saveAs,true);assert.match(download.url,/127\.0\.0\.1/);
    assert.equal(await a.evaluate(async()=>(await readStore('tasks','merged-job')).autoDownloadId),1);
    // A second tab sees the durable attempt and must not open another save dialog.
    const b=await context.newPage();await b.goto(url);await b.waitForFunction(()=>document.documentElement.dataset.ready==='true');
    await b.evaluate(async()=>{const task=await readStore('tasks','merged-job');await autoExportMergedTask({...task,state:'done'});});
    assert.equal(await b.evaluate(()=>window.downloadCalls?.length || 0),0);
    await a.evaluate(async()=>{applyLang('en');navigateWorkspace('library');await renderRecordingLibrary();});
    assert.equal(await a.getByRole('button',{name:'Merge & download (compressed)',exact:true}).count(),1);
    // Old helpers must fail before transferring any video.
    await a.evaluate(()=>{connectHelper=async()=>({merge:true});uploadedParts=[];});
    await a.getByRole('button',{name:'Merge & download (compressed)',exact:true}).click();
    await a.waitForFunction(()=>$('library-status').textContent.includes('Update the local helper'));
    assert.deepEqual(await a.evaluate(()=>uploadedParts),[]);
    // Download cancellation is durable and falls back to the explicit export action.
    await a.evaluate(async()=>{
      const original=await readStore('tasks','merged-job');
      const task={...original,id:'cancelled-download',state:'done',autoDownloadAttemptedAt:undefined,autoDownloadId:undefined};
      await runTx('tasks','readwrite',tx=>tx.objectStore('tasks').put(task));
      chrome.downloads.download=async()=>{window.failedDownloads=(window.failedDownloads||0)+1;throw Error('User cancelled');};
      await autoExportMergedTask(task);await autoExportMergedTask(task);
    });
    assert.equal(await a.evaluate(()=>failedDownloads),1);
    assert.match(await a.evaluate(async()=>(await readStore('tasks','cancelled-download')).autoDownloadError),/User cancelled/);
    assert.equal(await a.evaluate(async()=>(await readStore('recordings')).length),3);
    assert.deepEqual(errors,[]);
  } finally {
    await browser.close();await new Promise(resolve=>server.close(resolve));
  }
});
