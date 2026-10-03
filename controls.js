const zh=chrome.i18n.getUILanguage().startsWith('zh');document.documentElement.lang=zh?'zh-CN':'en';
for(const [id,cn,en] of [['pause','暂停 / 继续','Pause / resume'],['mark','标记重点','Mark'],['stop','停止录制','Stop']])document.getElementById(id).textContent=zh?cn:en;
document.getElementById('hint').textContent=zh?'共享 Telegram 标签页时，此独立控制窗不会出现在视频中。共享整个屏幕时可能会录到控制窗。':'Share the Telegram tab to exclude this window. Whole-screen capture may include it.';
async function command(action){const result=await chrome.runtime.sendMessage({type:'recorder-control',action});if(result?.error)document.getElementById('status').textContent=result.error;else await refresh();}
for(const [id,action] of [['pause','pause-recording'],['mark','mark-important'],['stop','stop-recording']])document.getElementById(id).onclick=()=>command(action).catch(showError);
function showError(error){document.getElementById('status').textContent=error.message;}
async function refresh(){const state=await chrome.runtime.sendMessage({type:'recorder-control',action:'get-recording-status'});const active=state?.active;for(const id of ['pause','mark','stop'])document.getElementById(id).disabled=!active;document.getElementById('status').textContent=active ? `${state.paused ? (zh?'已暂停':'Paused'):'REC'} · ${Math.floor(state.elapsed/1000)} s · ${zh?'音量':'Audio'} ${Math.round((state.volume || 0)*100)}%`:(state?.error || (zh?'录制已结束':'Recording ended'));}
refresh().catch(showError);setInterval(()=>refresh().catch(showError),1000);
