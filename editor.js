let editorSource = null, editorUrl = null, editorSize = null, editorSubmitting = false;
function clearVideoEditor() { const video=$('edit-preview');video.pause();video.removeAttribute('src');video.load();if(editorUrl)URL.revokeObjectURL(editorUrl);editorUrl=null;editorSource=null; }
async function openVideoEditor(entry) {
  if(editorSubmitting)return;editorSource=entry;editorSize=null;$('remember-channel-crop').checked=false;$('remember-channel-crop').disabled=!entry.channelId;$('edit-rotation').value='0';$('edit-landscape').checked=false;$('edit-status').textContent='';$('edit-start').value='0';$('edit-end').value=entry.duration ? (entry.duration/1000).toFixed(2):'';
  const blob=await readStore('videos',entry.id);if(!blob)throw new Error(L('errEmpty'));
  if(editorUrl)URL.revokeObjectURL(editorUrl);editorUrl=URL.createObjectURL(blob);$('edit-preview').src=editorUrl;$('edit-panel').showModal();
  $('edit-preview').onloadedmetadata=()=>{const video=$('edit-preview');editorSize={width:video.videoWidth,height:video.videoHeight};if(!Number.isFinite(Number($('edit-end').value)) || !$('edit-end').value)$('edit-end').value=Number.isFinite(video.duration)?video.duration.toFixed(2):'';resetCrop();restoreChannelCrop().catch(error=>$('edit-status').textContent=error.message);};
}
function resetCrop() {
  if(!editorSize)return;for(const [key,value] of Object.entries({x:0,y:0,width:editorSize.width,height:editorSize.height}))$(`crop-${key}`).value=String(value);drawCrop();
}
function cropValues() { return ['x','y','width','height'].map(key=>Number($(`crop-${key}`).value)); }
function drawCrop() {
  if(!editorSize)return;const [x,y,w,h]=cropValues(),overlay=$('crop-overlay');
  overlay.style.setProperty('--crop-x',`${100*x/editorSize.width}%`);overlay.style.setProperty('--crop-y',`${100*y/editorSize.height}%`);overlay.style.setProperty('--crop-w',`${100*w/editorSize.width}%`);overlay.style.setProperty('--crop-h',`${100*h/editorSize.height}%`);
  drawRotationPreview();
  overlay.setAttribute('aria-label',`${L('cropPixels')}: ${x}, ${y}, ${w} × ${h}`);
}
let cropDrag = null;
function cropPoint(event) {
  const rect=$('edit-preview').getBoundingClientRect();return {x:Math.max(0,Math.min(editorSize.width,Math.round((event.clientX-rect.left)/rect.width*editorSize.width))),y:Math.max(0,Math.min(editorSize.height,Math.round((event.clientY-rect.top)/rect.height*editorSize.height)))};
}
$('crop-overlay').onpointerdown=event=>{if(!editorSize)return;event.preventDefault();cropDrag=cropPoint(event);$('crop-overlay').setPointerCapture(event.pointerId);};
$('crop-overlay').onpointermove=event=>{if(!cropDrag)return;const end=cropPoint(event),x=Math.floor(Math.min(cropDrag.x,end.x)/2)*2,y=Math.floor(Math.min(cropDrag.y,end.y)/2)*2,w=Math.max(2,Math.floor(Math.abs(end.x-cropDrag.x)/2)*2),h=Math.max(2,Math.floor(Math.abs(end.y-cropDrag.y)/2)*2);for(const [key,value] of Object.entries({x,y,width:Math.min(w,editorSize.width-x),height:Math.min(h,editorSize.height-y)}))$(`crop-${key}`).value=String(value);drawCrop();};
$('crop-overlay').onpointerup=$('crop-overlay').onpointercancel=()=>{cropDrag=null;};
for(const key of ['x','y','width','height'])$(`crop-${key}`).oninput=drawCrop;
$('edit-reset-crop').onclick=resetCrop;
$('edit-in').onclick=()=>{$('edit-start').value=$('edit-preview').currentTime.toFixed(2);};
$('edit-out').onclick=()=>{$('edit-end').value=$('edit-preview').currentTime.toFixed(2);};
$('edit-close').onclick=()=>{$('edit-panel').close();clearVideoEditor();};
$('edit-panel').addEventListener('cancel',clearVideoEditor);
$('edit-save').onclick=async()=>{
  if(editorSubmitting || !editorSource || !editorSize)return;
  const rotation=Number($('edit-rotation').value);
  const start=Number($('edit-start').value),end=Number($('edit-end').value),crop=cropValues(),[x,y,w,h]=crop;
  if(!Number.isFinite(rotation) || rotation<0 || rotation>360 || !Number.isFinite(start) || !Number.isFinite(end) || start<0 || end<=start || crop.some(value=>!Number.isInteger(value)) || x<0 || y<0 || w<2 || h<2 || x+w>editorSize.width || y+h>editorSize.height){$('edit-status').textContent=E('请检查开始/结束时间及裁剪区域。','Check the trim range and crop coordinates.');return;}
  if(!enhancementToken){$('edit-status').textContent=L('helperOffline');return;}
  editorSubmitting=true;$('edit-save').disabled=true;
  try {
    const source=editorSource,cropPreference={crop,width:editorSize.width,height:editorSize.height},remember=$('remember-channel-crop').checked;
    const task=await submitProcessing(source,{mode:'edit',preview:false,start,end,crop,rotation,landscape:$('edit-landscape').checked});
    if(remember && source.channelId){const profile=await readStore('meta','channel:'+source.channelId);if(profile)await runTx('meta','readwrite',tx=>tx.objectStore('meta').put({...profile,cropPreference},'channel:'+source.channelId));}
    $('edit-panel').close();clearVideoEditor();navigateWorkspace('tasks');
    // Completing after the editor closes is intentional. A reloaded page can retry from Tasks.
    while(true){const info=await(await enhancementRequest(`/jobs/${task.id}`)).json();if(info.state==='done'){await saveTaskResult({...task,...info});break;}if(['error','cancelled'].includes(info.state))throw new Error(info.error || L('jobCancelled'));await new Promise(resolve=>setTimeout(resolve,700));}
    await renderEnhancementTasks();
  }catch(error){$('edit-status').textContent=error.message;$('tasks-status').textContent=error.message;}
  finally{editorSubmitting=false;$('edit-save').disabled=false;}
};

function drawRotationPreview(){
  if(!editorSize || $('edit-preview').readyState<2)return;
  const [x,y,w,h]=cropValues(),degrees=Number($('edit-rotation').value),angle=degrees*Math.PI/180;
  if(!Number.isFinite(angle) || w<2 || h<2)return;
  const landscape=$('edit-landscape').checked;
  const width=Math.ceil(Math.abs(w*Math.cos(angle))+Math.abs(h*Math.sin(angle))-1e-8),height=Math.ceil(Math.abs(w*Math.sin(angle))+Math.abs(h*Math.cos(angle))-1e-8),scale=Math.min(1,720/Math.max(width,height));
  const canvas=$('rotation-preview');canvas.width=landscape ? 720:Math.ceil(width*scale);canvas.height=landscape ? 405:Math.ceil(height*scale);const fit=landscape ? Math.min(720/width,405/height):scale;const ctx=canvas.getContext('2d');ctx.fillStyle='black';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.translate(canvas.width/2,canvas.height/2);ctx.rotate(angle);ctx.drawImage($('edit-preview'),x,y,w,h,-w*fit/2,-h*fit/2,w*fit,h*fit);
}
$('edit-rotation').oninput=drawRotationPreview;
for(const button of document.querySelectorAll('[data-rotate]'))button.onclick=()=>{$('edit-rotation').value=button.dataset.rotate;drawRotationPreview();};
$('edit-preview').addEventListener('timeupdate',drawRotationPreview);$('edit-preview').addEventListener('loadeddata',drawRotationPreview);

async function restoreChannelCrop(){
 const source=editorSource;if(!source?.channelId)return;const profile=await readStore('meta','channel:'+source.channelId),pref=profile?.cropPreference;if(editorSource!==source || !pref || pref.width!==editorSize?.width || pref.height!==editorSize?.height)return;
 for(const [i,key] of ['x','y','width','height'].entries())$('crop-'+key).value=String(pref.crop[i]);drawCrop();
}
$('detect-video-area').onclick=()=>{
 try{const video=$('edit-preview');if(!editorSize || video.readyState<2)return;const canvas=document.createElement('canvas'),scale=Math.min(1,480/editorSize.width);canvas.width=Math.round(editorSize.width*scale);canvas.height=Math.round(editorSize.height*scale);const ctx=canvas.getContext('2d');ctx.drawImage(video,0,0,canvas.width,canvas.height);const {data}=ctx.getImageData(0,0,canvas.width,canvas.height),width=canvas.width,height=canvas.height;
 const rowDark=y=>{let dark=0;for(let x=0;x<width;x++){const i=(y*width+x)*4;if(Math.max(data[i],data[i+1],data[i+2])<18)dark++;}return dark/width>.98;};const colDark=x=>{let dark=0;for(let y=0;y<height;y++){const i=(y*width+x)*4;if(Math.max(data[i],data[i+1],data[i+2])<18)dark++;}return dark/height>.98;};
 let top=0,bottom=height-1,left=0,right=width-1;while(top<height/4 && rowDark(top))top++;while(bottom>height*.75 && rowDark(bottom))bottom--;while(left<width/4 && colDark(left))left++;while(right>width*.75 && colDark(right))right--;
 const even=value=>Math.floor(value/scale/2)*2;for(const [key,value] of Object.entries({x:even(left),y:even(top),width:even(right-left+1),height:even(bottom-top+1)}))$('crop-'+key).value=String(value);drawCrop();$('edit-status').textContent=E('仅根据当前帧建议去黑边，请检查多个时间点后再保存。','Border suggestion uses the current frame only. Check other positions before saving.');
 }catch(error){$('edit-status').textContent=error.message;}
};

$('edit-landscape').onchange=drawRotationPreview;
