// Validate the exact shipping ZIP in a disposable native-extension profile.
const {chromium}=require('playwright');const fs=require('fs'),os=require('os'),path=require('path'),cp=require('child_process');
(async()=>{
 const root=path.resolve(__dirname,'..'),version=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'))).version,zip=path.join(root,'store',`wescreen-${version}.zip`),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wescreen-package-')),unpacked=path.join(temp,'extension');fs.mkdirSync(unpacked);
 const extraction=cp.spawnSync('python3',['-c','import zipfile,sys; zipfile.ZipFile(sys.argv[1]).extractall(sys.argv[2])',zip,unpacked],{encoding:'utf8'});if(extraction.status!==0)throw new Error(extraction.stderr);
 let context;
 try{
  context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${unpacked}`,`--load-extension=${unpacked}`]});
  const worker=context.serviceWorkers()[0] || await context.waitForEvent('serviceworker'),id=new URL(worker.url()).host,page=await context.newPage(),errors=[];page.on('pageerror',error=>errors.push(error.message));await page.goto(`chrome-extension://${id}/recorder.html`);await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
  const checks=await page.evaluate(async()=>({version:chrome.runtime.getManifest().version,unlimitedStorage:await chrome.permissions.contains({permissions:['unlimitedStorage']}),channelWorkbench:!!$('channel-workbench'),rotation:!!$('edit-rotation'),batchQueue:typeof runBatch==='function'}));if(checks.version!==version || Object.values(checks).some(value=>value===false) || errors.length)throw new Error(JSON.stringify({checks,errors}));
  for(const lang of ['zh','en']){await page.evaluate(lang=>applyLang(lang),lang);await page.setViewportSize({width:390,height:844});if(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth))throw new Error(lang+' narrow layout overflow');}
  console.log(JSON.stringify({package:path.basename(zip),...checks,errors,narrowLanguages:['zh','en']}));
 }finally{if(context)await context.close();fs.rmSync(temp,{recursive:true,force:true});}
})().catch(error=>{console.error(error);process.exitCode=1;});
