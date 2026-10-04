// One settings workspace. Existing controls keep their state, IDs and handlers.
const playerSettings=morePanel;
playerSettings.classList.add('player-settings');
const settingsHeader=document.createElement('div');settingsHeader.className='settings-header';
const settingsTitle=polishLabel(document.createElement('strong'),'播放器设置','Player settings');
const settingsClose=polishLabel(document.createElement('button'),'关闭','Close');settingsClose.type='button';settingsClose.className='settings-close';settingsClose.onclick=()=>{moreMenu.open=false;moreMenu.querySelector('summary').focus();};settingsHeader.append(settingsTitle,settingsClose);
const settingsTabs=document.createElement('div');settingsTabs.className='settings-tabs';settingsTabs.setAttribute('role','tablist');
const settingsPages=new Map(),settingsButtons=new Map();
function settingsPage(key,zh,en){
 const button=polishLabel(document.createElement('button'),zh,en);button.type='button';button.id='settings-tab-'+key;button.setAttribute('role','tab');button.setAttribute('aria-controls','settings-page-'+key);
 const page=document.createElement('section');page.className='settings-page';page.id='settings-page-'+key;page.setAttribute('role','tabpanel');page.setAttribute('aria-labelledby',button.id);
 button.onclick=()=>selectPlayerSettings(key);settingsTabs.append(button);settingsPages.set(key,page);settingsButtons.set(key,button);return page;
}
function selectPlayerSettings(key,focus=false){
 for(const [name,page] of settingsPages){const selected=name===key,button=settingsButtons.get(name);page.hidden=!selected;button.setAttribute('aria-selected',String(selected));button.tabIndex=selected?0:-1;}
 playerSettings.scrollTop=0;if(focus)settingsButtons.get(key).focus();requestAnimationFrame(placePlayerMenus);
}
settingsTabs.addEventListener('keydown',event=>{if(!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();event.stopPropagation();const keys=[...settingsButtons.keys()],index=keys.findIndex(key=>settingsButtons.get(key)===document.activeElement),next=event.key==='Home'?0:event.key==='End'?keys.length-1:(index+(event.key==='ArrowRight'?1:-1)+keys.length)%keys.length;selectPlayerSettings(keys[next],true);});
const settingsPlayback=settingsPage('playback','播放','Playback'),settingsAudio=settingsPage('audio','声音','Audio'),settingsSubtitles=settingsPage('subtitles','字幕','Subtitles'),settingsTools=settingsPage('tools','工具','Tools');
function settingsSection(parent,zh,en,nodes){const section=document.createElement('section');section.className='settings-section';section.append(polishLabel(document.createElement('h4'),zh,en));for(const node of nodes.filter(Boolean))section.append(node);parent.append(section);return section;}
function settingsRow(nodes,className=''){const row=document.createElement('div');row.className='settings-row '+className;row.append(...nodes.filter(Boolean));return row;}
function settingsField(label,zh,en){
 let span=label.querySelector(':scope > span');if(!span){span=document.createElement('span');for(const child of [...label.childNodes])if(child.nodeType===Node.TEXT_NODE)child.remove();label.prepend(span);}polishLabel(span,zh,en);label.classList.add('settings-field');return label;
}
const versionField=settingsField($('playback-version').closest('label'),'视频版本','Video version');
settingsSection(settingsPlayback,'当前视频','Current video',[versionField]);
polishLabel($('player-frame-back'),'上一帧','Previous');polishLabel($('player-frame-next'),'下一帧','Next');settingsField(frameLabel,'帧率 · fps','Frame rate · fps');
settingsSection(settingsPlayback,'逐帧检查','Frame inspection',[settingsRow([$('player-frame-back'),$('player-frame-next')]),frameLabel]);
polishLabel($('player-loop-a'),'设置 A 点','Set A');polishLabel($('player-loop-b'),'设置 B 点','Set B');polishLabel($('player-loop-off'),'取消循环','Clear');
const settingsLoopState=document.createElement('p');settingsLoopState.className='settings-note';settingsLoopState.setAttribute('role','status');
const paintSettingsLoop=()=>settingsLoopState.textContent=playerLoop.a===null?E('在当前播放位置标记循环起点。','Mark the loop start at the current playback position.'):`A ${fmt(playerLoop.a*1000)}${playerLoop.b!==null?' · B '+fmt(playerLoop.b*1000):''} · ${playerLoop.enabled?E('循环中','Looping'):E('未启用','Off')}`;
for(const id of ['player-loop-a','player-loop-b','player-loop-off'])$(id).addEventListener('click',()=>queueMicrotask(paintSettingsLoop));$('preview').addEventListener('loadedmetadata',paintSettingsLoop);window.addEventListener('wescreen-language',paintSettingsLoop);paintSettingsLoop();
settingsSection(settingsPlayback,'A–B 循环','A–B loop',[settingsRow([$('player-loop-a'),$('player-loop-b'),$('player-loop-off')]),settingsLoopState]);
polishLabel($('player-bookmark'),'添加当前位置','Bookmark this position');settingsSection(settingsPlayback,'章节与书签','Chapters & bookmarks',[$('player-bookmark'),bookmarks]);
settingsField(audioLabel,'声音模式','Audio mode');settingsField(delayLabel,'音画同步 · 秒','Audio sync · seconds');syncButtons.className='settings-row';
settingsSection(settingsAudio,'播放声音','Playback audio',[audioLabel]);settingsSection(settingsAudio,'同步校准','Sync adjustment',[delayLabel,syncButtons]);
const syncNote=polishLabel(document.createElement('p'),'负值让声音提前，正值让声音延后。','Negative values play audio earlier; positive values delay it.');syncNote.className='settings-note';settingsAudio.lastElementChild.append(syncNote);
settingsField(subtitleLabel,'本地字幕 · SRT / VTT','Local subtitles · SRT / VTT');settingsField(subtitleOffset,'字幕偏移 · 秒','Subtitle offset · seconds');
settingsField(subtitleFont,'字号 · px','Size · px');settingsField(subtitlePosition,'垂直位置 · %','Vertical position · %');subtitleStyle.className='settings-subtitle-style';
polishLabel($('player-subtitle-off'),'显示 / 隐藏字幕','Show / hide subtitles');settingsSection(settingsSubtitles,'字幕文件','Subtitle file',[subtitleLabel,$('player-subtitle-off')]);settingsSection(settingsSubtitles,'显示与同步','Appearance & sync',[subtitleStyle,subtitleOffset]);
const protection=settingsField($('realtime-text-protect').closest('label'),'保护桌面文字','Protect desktop text');protection.className='settings-toggle';protection.append($('realtime-text-protect'));
polishLabel(compareButton,'按住对比原画','Hold to compare original');settingsSection(settingsTools,'观看辅助','Viewing tools',[protection,compareButton]);
$('playback-enhance').removeAttribute('data-i18n');polishLabel($('playback-enhance'),'画质修复工作台','Video restoration');
polishLabel($('player-audio-repair'),'修复声音并另存','Repair audio & save');polishLabel($('player-trim-static'),'检查静止尾段','Check static tail');polishLabel($('player-watermark'),'局部画面填补','Local region fill');
const repairs=[$('playback-enhance'),$('player-face-restore'),$('player-audio-repair'),$('player-trim-static'),$('player-watermark')].filter(Boolean);
settingsSection(settingsTools,'后台处理','Background processing',repairs);
const repairNote=polishLabel(document.createElement('p'),'处理结果另存，保留原视频。','Processed results are saved separately; originals are preserved.');repairNote.className='settings-note';settingsTools.lastElementChild.append(repairNote);
// Legacy instantaneous enhancement remains an internal mechanism for Smart best.
const settingsInternal=document.createElement('div');settingsInternal.hidden=true;settingsInternal.id='player-settings-internal';settingsInternal.append($('playback-instant'),realtimePreference);$('playback-shell').append(settingsInternal);
playerSettings.replaceChildren(settingsHeader,settingsTabs,...settingsPages.values());
const settingsStatus=document.createElement('div');settingsStatus.className='settings-engine-status';settingsStatus.append(realtimeHint);settingsTools.append(settingsStatus);
for(const button of repairs){const action=button.onclick;button.onclick=async event=>{try{if(document.fullscreenElement)await document.exitFullscreen();moreMenu.open=false;await action?.call(button,event);}catch(error){$('playback-status').textContent=error.message;}};}
// Menus remain usable in native fullscreen and close with Escape/outside clicks.
window.addEventListener('wescreen-language',()=>{moreMenu.querySelector('summary').setAttribute('aria-label',E('播放器设置','Player settings'));moreMenu.querySelector('summary').title=E('播放器设置','Player settings');});
selectPlayerSettings('playback');
