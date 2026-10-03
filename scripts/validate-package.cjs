// Validate the exact shipping ZIP in a disposable native-extension profile.
const {chromium}=require('playwright');const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version,zip=path.join(root,'store',`wescreen-${version}.zip`),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wescreen-package-')),unpacked=path.join(temp,'extension');fs.mkdirSync(unpacked);
 const extraction=cp.spawnSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',zip,unpacked],{encoding:'utf8'});if(extraction.status!==0)throw new Error(extraction.stderr);
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${unpacked}`,`--load-extension=${unpacked}`]});
  await context.route('http://127.0.0.1:8765/**', route=>route.abort());
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${id}/recorder.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  const checks=await page.evaluate(async()=>({version:chrome.runtime.getManifest().version,versionBadge:document.querySelector('[data-app-version]').textContent==='v'+chrome.runtime.getManifest().version,unlimitedStorage:await chrome.permissions.contains({permissions:['unlimitedStorage']}),channelWorkbench:!!$('channel-workbench'),rotation:!!$('edit-rotation'),batchQueue:typeof runBatch==='function'}));if(checks.version!==version || Object.values(checks).some(value=>value===false) || errors.length)throw new Error(JSON.stringify({checks,errors}));
  await page.goto(`chrome-extension://${id}/popup.html`);await page.waitForFunction(()=>!document.querySelector('[data-app-version]').hidden);if(await page.locator('[data-app-version]').textContent()!=='v'+version)throw new Error('Popup version mismatch');await page.goto(`chrome-extension://${id}/recorder.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  if(await page.locator('#course-panel').isVisible())throw new Error('Course recording remains visible');
  if(await page.locator('.github-link').getAttribute('href')!=='https://github.com/susunola/wescreen/releases/latest')throw new Error('Missing download link');
  await page.evaluate(async()=>{await chrome.storage.local.set({settings:{'course-enabled':true,'course-name':'Old course'}});await loadSettings();});
  if(await page.locator('#course-enabled').isChecked())throw new Error('Old course setting changes new recording');
  for(const lang of ['zh','en']){await page.evaluate(lang=>applyLang(lang),lang);await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(lang+' narrow layout overflow');}
  await page.setViewportSize({width:1280,height:800});
  await page.evaluate(async()=>{const canvas=document.createElement('canvas');canvas.width=320;canvas.height=180;const drawing=canvas.getContext('2d');window.testFrames=setInterval(()=>{drawing.fillStyle='blue';drawing.fillRect(0,0,320,180);},33);navigator.mediaDevices.getDisplayMedia=async()=>canvas.captureStream(30);$('preflight-enabled').checked=false;$('countdown').value='0';$('screen-audio').checked=false;$('clicks').checked=false;await start();});
  await page.waitForTimeout(1200);const control=await context.newPage();await control.goto(`chrome-extension://${id}/controls.html`);await control.waitForFunction(()=>!document.getElementById('pause').disabled);await control.locator('#pause').click();await page.waitForFunction(()=>recorder.state==='paused');await control.locator('#pause').click();await page.waitForFunction(()=>recorder.state==='recording');await control.locator('#stop').click();await page.waitForFunction(()=>recorder===null && finalId);await page.waitForFunction(()=>$('review-frames').children.length===3);checks.controlRouting=true;await control.close();
  const savedId=await page.evaluate(()=>finalId);await page.locator('[data-view=library]').click();await page.locator('[data-view=capture]').click();if(!await page.locator('#setup').isVisible())throw new Error('Recording menu stays on result');if(!await page.evaluate(async id=>!!(await readStore('recordings',id)),savedId))throw new Error('Returning to setup removed saved recording');
  await page.evaluate(()=>show('result'));await page.locator('#new-recording').click();if(!await page.locator('#setup').isVisible())throw new Error('Next recording failed');checks.nextRecordingNavigation=true;
  await context.unroute('http://127.0.0.1:8765/**');
  await context.route('http://127.0.0.1:8765/**',route=>{const url=new URL(route.request().url());return route.fulfill({json:url.pathname==='/connect' ? {token:'test-credential-for-isolated-check'} : url.pathname==='/health' ? {ready:true,ai:true,strong:true} : {jobs:[]}});});
  await page.evaluate(async()=>{await connectHelper();navigateWorkspace('tasks');await renderEnhancementTasks();});
  if(!await page.locator('#tasks-empty').isVisible() || await page.locator('#tasks-connect').isVisible())throw new Error('Connected empty processing state incorrect');
  await page.locator('#tasks-library').click();if(!await page.locator('#recording-library').isVisible())throw new Error('Empty-state library action failed');
  await page.locator('[data-view=tasks]').click();await page.evaluate(()=>applyLang('zh'));
  if(process.env.WESCREEN_UI_SCREENSHOT)await page.screenshot({path:process.env.WESCREEN_UI_SCREENSHOT,fullPage:true});
  for(const lang of ['zh','en']){await page.evaluate(lang=>applyLang(lang),lang);await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error('Processing narrow overflow '+lang);}
  await page.waitForFunction(()=>!taskPolling && !helperConnecting);
  await context.unroute('http://127.0.0.1:8765/**');await context.route('http://127.0.0.1:8765/**',route=>route.abort());
  await page.evaluate(async()=>{await renderEnhancementTasks();});await page.waitForFunction(()=>!document.getElementById('tasks-connect').hidden);if(!await page.locator('#tasks-connect').isVisible())throw new Error('Offline reconnect action missing');
  checks.processingEmptyState=true;checks.processingConnectionStatus=true;

  console.log(JSON.stringify({package:path.basename(zip),...checks,errors,narrowLanguages:['zh','en']}));
 }finally{if(context)await context.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
