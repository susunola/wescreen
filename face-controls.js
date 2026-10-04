// Face restoration is an offline, preview-first workflow.
let facePreviewReceipt=null;
const faceOption=document.createElement('option');faceOption.value='face';$('enhance-mode').append(faceOption);
const faceControls=document.createElement('section');faceControls.id='enhance-face-controls';faceControls.hidden=true;
const faceFidelityLabel=document.createElement('label');faceFidelityLabel.className='settings-field';const faceFidelityText=document.createElement('span');const faceFidelity=document.createElement('input');faceFidelity.type='range';faceFidelity.id='face-fidelity';faceFidelity.min='.5';faceFidelity.max='1';faceFidelity.step='.05';faceFidelity.value='.8';faceFidelityLabel.append(faceFidelityText,faceFidelity);
const faceNotice=document.createElement('p');faceNotice.className='hint';
const faceConfirmLabel=document.createElement('label');faceConfirmLabel.className='check';const faceConfirm=document.createElement('input');faceConfirm.type='checkbox';faceConfirm.id='face-preview-confirm';const faceConfirmText=document.createElement('span');faceConfirmLabel.append(faceConfirm,faceConfirmText);
const faceSetup=document.createElement('a');faceSetup.href='helper-guide.html#face-restoration';faceSetup.target='_blank';faceSetup.rel='noopener noreferrer';faceSetup.className='hint';faceControls.append(faceFidelityLabel,faceNotice,faceConfirmLabel,faceSetup);enhanceSettings.after(faceControls);
function faceSettingsSignature(){return JSON.stringify([enhancementSource?.id,Number(faceFidelity.value),Number($('enhance-strength').value)]);}
function facePreviewMatches(){return facePreviewReceipt?.signature===faceSettingsSignature();}
function updateFaceControls(){
 const selected=$('enhance-mode').value==='face';faceControls.hidden=!selected;
 faceOption.textContent=E('脸部修复 · 实验性','Face restoration · experimental');faceFidelityText.textContent=E('输入保真','Source fidelity')+' '+Math.round(Number(faceFidelity.value)*100)+'%';
 faceNotice.textContent=E('保真越高越接近输入，修复变化越少。重遮挡无法可靠还原五官；补全可能改脸，逐帧处理也可能闪烁。','Higher fidelity stays closer to the input. Heavy masking cannot reliably recover facial features; generated detail may change identity or flicker.');
 faceConfirmText.textContent=E('已检查预览，接受脸部变化并另存整段','I checked the preview and accept the changes for a separately saved full video');faceSetup.textContent=E('安装脸部模型 · CodeFormer','Install face model · CodeFormer');
 faceSetup.hidden=!!helperHealth?.face;faceConfirm.disabled=enhancementBusy || !facePreviewMatches();if(!facePreviewMatches())faceConfirm.checked=false;
 faceFidelity.disabled=enhancementBusy;$('enhance-strength').disabled=enhancementBusy;
 if(selected){
  $('enhance-mode-hint').textContent=helperHealth?.face ? E('仅局部处理检测到的脸，保持源分辨率；先生成预览，再确认整段。','Restores detected faces at source resolution. Preview first, then confirm full processing.') : E('需要安装本机脸部模型：运行增强包中的 install-face.command，再重新连接。','Install the local face model with install-face.command, then reconnect.');
  $('enhance-preview').disabled=enhancementBusy || !enhancementSource || !helperHealth?.face;
  $('enhance-full').disabled=$('enhance-preview').disabled || !facePreviewMatches() || !faceConfirm.checked;
  $('enhance-disabled-reason').hidden=false;$('enhance-disabled-reason').textContent=!helperHealth?.face ? E('脸部模型尚未就绪。','Face model is not ready.') : !facePreviewMatches() ? E('请先预览；调整参数或切换视频后需重新预览。','Preview first; changed settings or source require a new preview.') : !faceConfirm.checked ? E('检查对比预览后，勾选确认即可处理整段。','Check the comparison and confirm before processing the full video.') : '';
 }
}
const baseEnhancementMode=updateEnhancementMode;updateEnhancementMode=function(){baseEnhancementMode();updateFaceControls();};
for(const input of [faceFidelity,$('enhance-strength'),faceConfirm])input.addEventListener('input',updateEnhancementMode);
window.addEventListener('wescreen-language',updateEnhancementMode);
const faceTool=document.createElement('button');faceTool.type='button';faceTool.id='player-face-restore';polishLabel(faceTool,'脸部修复 · 先预览','Face restoration · preview first');faceTool.onclick=async()=>{if(enhancementBusy){navigateWorkspace('tasks');return;}const entry=await readStore('recordings',activePlaybackId || finalId);if(!entry || entry.deletedAt)throw new Error(E('请先打开录像。','Open a recording first.'));await openEnhancement(entry);$('enhance-mode').value='face';faceConfirm.checked=false;updateEnhancementMode();};
$('playback-enhance').after(faceTool);updateFaceControls();
