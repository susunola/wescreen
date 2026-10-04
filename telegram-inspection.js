// Bounded, advisory sampling. Never rewrites or removes original videos.
let telegramInspectionBusy=false;
function classifyInspectionSamples(samples){
 const warnings=[];for(let i=1;i<samples.length;i++){
  const a=samples[i-1],b=samples[i];if(a.part!==b.part || b.at-a.at<2)continue;
  if(a.black>.98 && b.black>.98)warnings.push({kind:'black',start:a.at,end:b.at});
  else if(a.pixels && b.pixels){let delta=0;for(let j=0;j<a.pixels.length;j++)delta+=Math.abs(a.pixels[j]-b.pixels[j]);if(delta/a.pixels.length<.8 && b.at-a.at>=15)warnings.push({kind:'still',start:a.at,end:b.at});}
 }return warnings;
}
function inspectionLabel(report){
 const labels={black:E('疑似黑屏','Possible black screen'),still:E('疑似静止画面','Possible static scene')};
 const notes=report.warnings.map(w=>w.kind==='audio'?E('未检测到明显源声音','No audible source signal detected'):w.kind==='duration'?E('录像与源播放时长有差异，请检查','Recording duration differs from source playback; check it'):w.kind==='resolution'?E('采集像素低于源视频','Capture resolution below source'):w.kind==='write'?E('录制期间写入有延迟','Storage writes were delayed'):`${labels[w.kind]} ${fmt(w.start*1000)}–${fmt(w.end*1000)}`);
 return E('抽样验收：','Sample inspection: ')+(notes.length?notes.join(' · '):E('未发现明显异常','No obvious issues found'))+(report.partial?E('（未完整抽样）',' (partial sampling)'):'');
}
async function inspectTelegramRecording(id){
 if(telegramInspectionBusy)return;telegramInspectionBusy=true;
 try{
  const all=await readStore('recordings'),entry=all.find(e=>e.id===id);if(!entry || entry.deletedAt)return;
  const parts=(entry.recordingGroupId?all.filter(e=>e.recordingGroupId===entry.recordingGroupId && !e.deletedAt && !e.enhancedFrom):[entry]).sort((a,b)=>(a.part||1)-(b.part||1));
  const total=parts.reduce((n,e)=>n+(e.duration||0)/1000,0),samples=[],deadline=performance.now()+20000;let offset=0,partial=false;
  for(const part of parts){
   if(performance.now()>deadline){partial=true;break;}
   const blob=await readStore('videos',part.id);if(!blob){partial=true;offset+=(part.duration||0)/1000;continue;}
   const video=document.createElement('video'),url=URL.createObjectURL(blob);video.muted=true;video.preload='auto';
   const wait=event=>new Promise((resolve,reject)=>{const clean=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',fail);},done=()=>{clean();resolve();},fail=()=>{clean();reject(new Error('Inspection decode failed'));},timer=setTimeout(fail,Math.max(1,Math.min(3000,deadline-performance.now())));video.addEventListener(event,done,{once:true});video.addEventListener('error',fail,{once:true});});
   try{
    const loaded=wait('loadeddata');video.src=url;await loaded;const duration=Number.isFinite(video.duration)?video.duration:(part.duration||0)/1000;
    const canvas=document.createElement('canvas');canvas.width=64;canvas.height=Math.max(2,Math.round(64*video.videoHeight/video.videoWidth));const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const count=Math.max(2,Math.min(24,Math.ceil(24*duration/Math.max(1,total))));
    for(let i=0;i<count;i++){
     if(performance.now()>deadline){partial=true;break;}const target=Math.max(.001,Math.min(Math.max(.001,duration-.05),i*duration/(count-1)));
     if(Math.abs(video.currentTime-target)>.0001){const seek=wait('seeked');video.currentTime=target;await seek;}
     ctx.drawImage(video,0,0,canvas.width,canvas.height);const rgba=ctx.getImageData(0,0,canvas.width,canvas.height).data,pixels=new Uint8Array(rgba.length/4);let black=0;
     for(let j=0,k=0;j<rgba.length;j+=4,k++){pixels[k]=Math.round(.2126*rgba[j]+.7152*rgba[j+1]+.0722*rgba[j+2]);if(pixels[k]<8)black++;}
     samples.push({part:part.id,at:offset+target,black:black/pixels.length,pixels});
    }
   }catch{partial=true;}finally{video.removeAttribute('src');video.load();URL.revokeObjectURL(url);}
   offset+=(part.duration||0)/1000;
  }
  const warnings=classifyInspectionSamples(samples),d=entry.captureDiagnostics;
  if(d){if(d.audioSamples>=10 && !d.audioObserved)warnings.push({kind:'audio'});if(d.maxWriteAge>20)warnings.push({kind:'write'});const span=d.sourceEndTime-d.sourceStartTime;if(Number.isFinite(span)&&span>3&&Math.abs(total-span)>Math.max(3,span*.1))warnings.push({kind:'duration'});if(entry.videoRegion && (entry.width<d.sourceWidth*.9||entry.height<d.sourceHeight*.9))warnings.push({kind:'resolution'});}
  const inspection={at:Date.now(),samples:samples.length,partial,warnings:warnings.slice(0,12)};
  for(const part of parts){const current=await readStore('recordings',part.id);if(current&&!current.deletedAt)await updateRecording(part.id,{inspection});}
  if(activePlaybackId && parts.some(e=>e.id===activePlaybackId)){$('review-summary').textContent+=' · '+inspectionLabel(inspection);}
 }finally{telegramInspectionBusy=false;}
}
