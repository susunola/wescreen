// Compact enhancement workspace; move existing controls without replacing their handlers.
const enhanceSettings=document.createElement('div');enhanceSettings.className='enhance-settings';
const modeField=$('enhance-mode').closest('label'),strengthField=$('enhance-strength').closest('label');
modeField.before(enhanceSettings);enhanceSettings.append(modeField,strengthField);
const strengthOutput=document.createElement('output');strengthOutput.htmlFor='enhance-strength';strengthField.querySelector('span').append(strengthOutput);
const updateStrength=()=>strengthOutput.textContent=' '+Math.round(Number($('enhance-strength').value)*100)+'%';$('enhance-strength').addEventListener('input',updateStrength);updateStrength();
const enhanceAdvanced=document.createElement('details');enhanceAdvanced.id='enhance-output-options';enhanceAdvanced.className='advanced enhance-options';const outputSummary=document.createElement('summary');enhanceAdvanced.append(outputSummary,hdrChoice,masterChoice);$('enhance-mode-hint').after(enhanceAdvanced);
const helperDetails=document.createElement('details');helperDetails.id='helper-help';helperDetails.className='enhance-help';const helperSummary=document.createElement('summary');helperDetails.append(helperSummary,helperLaunchHint,helperDiagnosis,$('helper-auto-hint'));$('helper-actions').after(helperDetails);
const durationField=$('preview-seconds').closest('label'),actionRow=$('enhance-preview').parentElement;actionRow.classList.add('enhance-action-row');actionRow.prepend(durationField);
const durationHint=durationField.nextElementSibling?.matches('[data-i18n=previewPositionHint]')?durationField.nextElementSibling:$('enhance-panel').querySelector('[data-i18n=previewPositionHint]');if(durationHint)actionRow.after(durationHint);
const refreshEnhanceLayout=()=>{outputSummary.textContent=E('输出选项 · HDR / 母带','Output options · HDR / master');helperSummary.textContent=E('安装与连接诊断','Setup & connection diagnostics');strengthField.querySelector('span').firstChild.textContent=E('修复强度','Restoration strength');};window.addEventListener('wescreen-language',refreshEnhanceLayout);refreshEnhanceLayout();
