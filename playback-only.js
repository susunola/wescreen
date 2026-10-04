// Restoration is a viewing operation. Existing processed files/jobs remain exportable.
async function watchWithSmartBest(entry){
 if(entry)await playRecording(entry);
 if(!$('preview').getAttribute('src')){$('playback-status').textContent=E('请先打开视频。','Open a video first.');navigateWorkspace('player');return;}
 navigateWorkspace('player');await realtimeButton.onclick();
}
openEnhancement=watchWithSmartBest;
// Remove the separate offline quality choice and route legacy callers to Smart best.
$('playback-ai').hidden=true;$('playback-ai').onclick=()=>watchWithSmartBest();
$('playback-enhance').hidden=true;$('playback-enhance').onclick=()=>watchWithSmartBest();
for(const id of ['player-face-restore','player-audio-repair','batch-add','batch-mode','batch-queue-panel'])if($(id))$(id).hidden=true;
$('batch-mode')?.closest('label')?.setAttribute('hidden','');
// Existing queue metadata is retained, but new offline restoration cannot be dispatched.
enqueueBatch=async()=>{};runBatch=async()=>{};
const oldRenderBatch=renderBatch;renderBatch=async()=>{await oldRenderBatch();$('batch-queue-panel').hidden=true;};
function updateViewingCopy(){
 I18N.zh.enhanceRecording='智能最佳播放';I18N.en.enhanceRecording='Play with Smart best';
 UI_TEXT.zh.bulkHint='选择录像以批量管理。画质修复在播放器的“智能最佳”中进行。';
 UI_TEXT.en.bulkHint='Select recordings to manage them. Use Smart best in the player for restoration.';
 UI_TEXT.zh.tasksEmptyHint='从录像库选择视频进行剪辑；画质修复在播放器内进行。';UI_TEXT.en.tasksEmptyHint='Choose a recording to edit. Restore picture quality in the player.';
 UI_TEXT.zh.tasksHint='剪辑结果保存在本机。';UI_TEXT.en.tasksHint='Edited results stay on this device.';
 UI_TEXT.zh.aboutHelperModes='智能最佳 · 本机观看修复';UI_TEXT.en.aboutHelperModes='Smart best · Local playback restoration';
 for(const key of ['bulkHint','tasksEmptyHint','tasksHint','aboutHelperModes'])document.querySelectorAll('[data-i18n='+key+']').forEach(node=>node.textContent=L(key));
}
updateViewingCopy();window.addEventListener('wescreen-language',updateViewingCopy);

document.querySelector('[data-i18n=aboutSeedOptional]')?.closest('.about-package')?.setAttribute('hidden','');
