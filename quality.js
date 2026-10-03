// The primary quality menu has exactly three choices. Advanced controls live under More.
const advancedQuality=document.createElement('details');advancedQuality.id='player-quality-advanced';advancedQuality.className='advanced';advancedQuality.append(polishLabel(document.createElement('summary'),'画质高级设置','Advanced picture settings'));
const qualityKeep=new Set([originalPicture,realtimeButton,$('playback-ai')]);
for(const node of [...qualityPanel.children])if(!qualityKeep.has(node))advancedQuality.append(node);
morePanel.append(advancedQuality);
originalPicture.removeAttribute('data-i18n');realtimeButton.removeAttribute('data-i18n');$('playback-ai').removeAttribute('data-i18n');
polishLabel(originalPicture,'原画','Original');polishLabel(realtimeButton,'智能最佳','Smart best');polishLabel($('playback-ai'),'AI 高清修复','AI HD repair');
qualityPanel.classList.add('simple-quality');qualityPanel.replaceChildren(originalPicture,realtimeButton,$('playback-ai'));
const qualityCaption=qualityMenu.querySelector('summary');qualityCaption.removeAttribute('data-i18n');
let selectedQuality='original',qualityStateGeneration=0;
function displaySelectedQuality(mode){selectedQuality=mode;const labels={original:['原画','Original'],smart:['智能最佳','Smart best'],repair:['AI 高清修复','AI HD repair']};qualityCaption.textContent=E(...labels[mode]);qualityCaption.title=E('当前画质：','Current quality: ')+qualityCaption.textContent;qualityCaption.setAttribute('aria-label',qualityCaption.title);for(const [button,key] of [[originalPicture,'original'],[realtimeButton,'smart'],[$('playback-ai'),'repair']]){button.classList.toggle('quality-selected',key===mode);button.setAttribute('aria-pressed',String(key===mode));}}
async function refreshSelectedQuality(){const generation=++qualityStateGeneration,entry=activePlaybackId?await readStore('recordings',activePlaybackId):null;if(generation!==qualityStateGeneration)return;displaySelectedQuality(realtimeAI.enabled||instantEnhancement?'smart':entry&&['ai','strong'].includes(entry.enhancement)?'repair':'original');}
const originalClick=originalPicture.onclick;
originalPicture.onclick=async()=>{try{stopRealtimeAI();originalClick();const entry=activePlaybackId?await readStore('recordings',activePlaybackId):null;if(entry&&['ai','strong'].includes(entry.enhancement)&&entry.enhancedFrom){const source=await readStore('recordings',entry.enhancedFrom);if(!source||source.deletedAt)throw new Error(E('原视频已删除。','Original video was deleted.'));pendingPlaybackPosition={id:source.id,time:$('preview').currentTime,playing:!$('preview').paused};await playRecording(source);}displaySelectedQuality('original');qualityMenu.open=false;}catch(error){$('playback-status').textContent=error.message;}};
const smartClick=realtimeButton.onclick;
realtimeButton.onclick=async()=>{if(realtimeAI.enabled||instantEnhancement){qualityMenu.open=false;return;}await smartClick();if(!realtimeAI.enabled){const message=realtimeHint.textContent;if(!instantEnhancement)$('playback-instant').click();$('playback-status').textContent=message+E(' · 已启用轻量观看增强，保留原分辨率。',' · Lightweight viewing enhancement enabled; original resolution retained.');}displaySelectedQuality('smart');qualityMenu.open=false;};
const repairClick=$('playback-ai').onclick;$('playback-ai').onclick=async()=>{qualityMenu.open=false;await repairClick();refreshSelectedQuality().catch(()=>{});};
const oldStopRealtime=stopRealtimeAI;stopRealtimeAI=function(message=''){oldStopRealtime(message);refreshSelectedQuality().catch(()=>{});};
$('preview').addEventListener('loadedmetadata',()=>refreshSelectedQuality().catch(()=>{}));
$('playback-instant').addEventListener('click',()=>refreshSelectedQuality().catch(()=>{}));
window.addEventListener('wescreen-language',()=>displaySelectedQuality(selectedQuality));displaySelectedQuality('original');
