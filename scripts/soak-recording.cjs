// Real MediaRecorder + IndexedDB soak with a deterministic synthetic AV source.
// This validates the recording engine; it does not certify OS screen capture or external drives.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const flags=Object.fromEntries(process.argv.slice(2).reduce((pairs,arg,i,args)=>arg.startsWith('--')?[...pairs,[arg.slice(2),args[i+1]]]:pairs,[]));
const realScreen=flags.source==='screen';
const seconds=Number(flags.seconds||60),rotate=Number(flags['rotate-seconds']||20);
if(!Number.isFinite(seconds)||seconds<5||seconds>86400||!Number.isFinite(rotate)||rotate<2)throw new Error('Use --seconds 5..86400 and --rotate-seconds >=2');
(async()=>{const root=path.resolve(__dirname,'..'),out=path.resolve(flags.output||path.join(root,'../audit-soak')),temp=fs.mkdtempSync(path.join(os.tmpdir(),'wescreen-soak-'));fs.mkdirSync(out,{recursive:true});let cx;
const report={source:realScreen?'user-selected OS screen capture':'deterministic synthetic AV',seconds,rotateSeconds:rotate,startedAt:new Date().toISOString(),samples:[],segments:[],errors:[]};
try{
 cx=await chromium.launchPersistentContext(temp,{headless:!realScreen,channel:'chromium',args:['--disable-extensions-except='+root,'--load-extension='+root,'--autoplay-policy=no-user-gesture-required','--disable-background-timer-throttling']});
 await cx.route('http://127.0.0.1:8765/**',route=>route.abort());const worker=cx.serviceWorkers()[0]||await cx.waitForEvent('serviceworker'),page=await cx.newPage();page.on('pageerror',e=>report.errors.push(e.name));
 await page.goto('chrome-extension://'+new URL(worker.url()).host+'/recorder.html');await page.waitForFunction(()=>document.documentElement.dataset.ready==='true');
 await page.evaluate(async realScreen=>{
  if(!realScreen){const canvas=document.createElement('canvas');canvas.width=1280;canvas.height=720;const paint=canvas.getContext('2d');let frame=0;
  window.soakFrames=setInterval(()=>{paint.fillStyle=frame%60<30?'#244f7d':'#3a6658';paint.fillRect(0,0,1280,720);paint.fillStyle='white';paint.font='48px sans-serif';paint.fillText('WeScreen AV soak '+frame++,80,150);paint.fillRect((frame*7)%1100,360,80,80);},33);
  const stream=canvas.captureStream(30),audio=new AudioContext(),osc=audio.createOscillator(),destination=audio.createMediaStreamDestination();osc.frequency.value=440;osc.connect(destination);osc.start();stream.addTrack(destination.stream.getAudioTracks()[0]);window.soakAudio=audio;
  navigator.mediaDevices.getDisplayMedia=async()=>stream;}$('capture-method').value='shared';$('preflight-enabled').checked=false;$('countdown').value='0';$('clicks').checked=false;$('screen-audio').checked=true;$('microphone').checked=false;$('camera').checked=false;$('format').value='mp4';if(!realScreen)await start();
 },realScreen);
 if(realScreen)await page.locator('#start').click();
 await page.waitForFunction(()=>recorder?.state==='recording',null,{timeout:60000});const start=Date.now();let nextRotate=rotate,nextSample=0;
 while((Date.now()-start)/1000<seconds){const elapsed=(Date.now()-start)/1000;if(elapsed>=nextRotate){await page.evaluate(()=>saveSegmentAndContinue());nextRotate+=rotate;}if(elapsed>=nextSample){report.samples.push(await page.evaluate(()=>({at:Date.now(),segments:segmentIndex,pendingWrites:pendingWrites.size,bufferBytes:chunkBytes,jsHeap:performance.memory?.usedJSHeapSize||null,videoState:recorder?.state})));nextSample+=5;fs.writeFileSync(path.join(out,'progress.json'),JSON.stringify({elapsed,seconds,segments:report.samples.at(-1).segments}));}await page.waitForTimeout(500);}
 await page.evaluate(()=>stop());await page.waitForFunction(()=>recorder===null&&finalId,null,{timeout:60000});
 const entries=await page.evaluate(async()=>(await readStore('recordings')).sort((a,b)=>a.part-b.part).map(e=>({id:e.id,part:e.part,duration:e.duration,size:e.size,frameRate:e.frameRate})));
 for(const [i,entry]of entries.entries()){
  const file=path.join(out,'part-'+String(i+1).padStart(4,'0')+'.mp4');
  // Stream the isolated test recording through a page download to avoid serializing large blobs.
  const download=page.waitForEvent('download');await page.evaluate(async id=>{const blob=await readStore('videos',id),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download='soak.mp4';a.click();setTimeout(()=>URL.revokeObjectURL(url),10000);},entry.id);await(await download).saveAs(file);
  const probe=spawnSync('ffprobe',['-v','error','-show_streams','-show_format','-of','json',file],{encoding:'utf8'});assert.equal(probe.status,0);const info=JSON.parse(probe.stdout);assert.ok(info.streams.some(s=>s.codec_type==='video'));assert.ok(info.streams.some(s=>s.codec_type==='audio'));
  for(const position of [.1,Number(info.format.duration)/2,Math.max(0,Number(info.format.duration)-.15)])assert.equal(spawnSync('ffmpeg',['-v','error','-ss',String(position),'-i',file,'-frames:v','1','-f','null','-']).status,0);
  report.segments.push({...entry,durationSeconds:Number(info.format.duration),videoDuration:info.streams.find(s=>s.codec_type==='video').duration,audioDuration:info.streams.find(s=>s.codec_type==='audio').duration});
 }
 const duration=report.segments.reduce((n,e)=>n+e.durationSeconds,0);assert.ok(duration>=seconds*.95,'Missing recorded duration');assert.ok(duration<=seconds+report.segments.length*.6+3,'Excessive segment overlap');assert.deepEqual(report.errors,[]);report.passed=true;report.recordedSeconds=duration;
} catch(error){report.passed=false;report.failure=error.message;process.exitCode=1;}
finally{if(!report.passed)report.recoveryProfile=temp;report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));await cx?.close();if(report.passed)fs.rmSync(temp,{recursive:true,force:true});console.log(JSON.stringify({passed:report.passed,segments:report.segments.length,report:path.join(out,'report.json')}));}})();
