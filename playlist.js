// History stores references only. Recording records remain authoritative.
const playlistKey='player-history';
const playlistChannel=typeof BroadcastChannel==='function'?new BroadcastChannel('wescreen-playlist'):null;
let playlistGeneration=0,playlistMutation=Promise.resolve();
function mutatePlaylistHistory(change){
  const task=playlistMutation.then(()=>runTx('meta','readwrite',tx=>{
    const store=tx.objectStore('meta'),request=store.get(playlistKey);
    request.onsuccess=()=>store.put(change(Array.isArray(request.result)?request.result:[]),playlistKey);
  }));
  playlistMutation=task.catch(()=>{});return task;
}
function playlistIdentity(entry){return entry.recordingGroupId?'group:'+entry.recordingGroupId:'recording:'+entry.id;}
function resolvePlaylistHistory(history,groups){
  const byId=new Map(),byKey=new Map();
  for(const group of groups){byKey.set(playlistIdentity(group),group);for(const part of group._parts||[group])byId.set(part.id,group);}
  const seen=new Set();return history.flatMap(item=>{
    const group=byKey.get(item.key)||byId.get(item.id)||(item.parts||[]).map(id=>byId.get(id)).find(Boolean);
    if(!group||seen.has(playlistIdentity(group)))return [];
    seen.add(playlistIdentity(group));return [{...item,id:group.id,key:playlistIdentity(group),parts:(group._parts||[group]).map(p=>p.id),entry:group}];
  });
}
async function rememberPlaylistRecording(entry){
  const key=playlistIdentity(entry),parts=(entry._parts||[entry]).map(p=>p.id);
  await mutatePlaylistHistory(history=>[{key,id:entry.id,parts,lastPlayed:Date.now()},...history.filter(item=>item.key!==key&&!parts.includes(item.id))]);
  notifyPlaybackLibraryChanged();
}
function notifyPlaybackLibraryChanged(){
  playlistChannel?.postMessage('changed');refreshPlayerPlaylist().catch(showPlaylistError);
}
function showPlaylistError(error){playlistNotice.textContent=E('播放列表读取失败，可重新打开重试。','Could not load the playlist. Reopen to retry.');console.warn('Playlist:',error.message);}
const playlistMenu=document.createElement('details');playlistMenu.id='player-playlist-menu';playlistMenu.className='cinema-menu';
const playlistSummary=document.createElement('summary');playlistSummary.title=E('播放列表','Playlist');playlistSummary.setAttribute('aria-label',playlistSummary.title);
playlistSummary.innerHTML='<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h16M4 10h16M4 15h8M4 20h8M16 14l5 3-5 3z"/></svg>';
const playlistPanel=document.createElement('div');playlistPanel.className='cinema-popover player-playlist-panel';
const playlistHeading=document.createElement('h3'),playlistNotice=document.createElement('p'),playlistList=document.createElement('div');playlistList.className='player-playlist-items';playlistList.setAttribute('aria-label',E('最近播放','Recently played'));
playlistPanel.append(playlistHeading,playlistNotice,playlistList);playlistMenu.append(playlistSummary,playlistPanel);cinemaTransport.insertBefore(playlistMenu,$('playback-pip'));cinemaMenus.push(playlistMenu);
playlistSummary.addEventListener('click',()=>{for(const menu of cinemaMenus)if(menu!==playlistMenu)menu.open=false;revealFullscreenControls();});
playlistMenu.addEventListener('toggle',()=>{if(playlistMenu.open)refreshPlayerPlaylist().then(()=>{if(typeof placePlayerMenus==='function')placePlayerMenus();}).catch(showPlaylistError);revealFullscreenControls();});
async function refreshPlayerPlaylist(){
  const generation=++playlistGeneration;
  await playlistMutation;
  const [history,records]=await Promise.all([readStore('meta',playlistKey),readStore('recordings')]);
  if(generation!==playlistGeneration)return;
  const rows=resolvePlaylistHistory(Array.isArray(history)?history:[],recordingGroups(records.filter(e=>!e.deletedAt)));
  // Remove deleted references atomically, preserving a concurrent addition from another tab.
  const deleted=new Set((Array.isArray(history)?history:[]).filter(item=>!rows.some(row=>row.key===item.key||row.id===item.id||row.parts.includes(item.id))).map(item=>item.key));
  if(deleted.size)await mutatePlaylistHistory(items=>items.filter(item=>!deleted.has(item.key)));
  if(generation!==playlistGeneration)return;
  playlistHeading.textContent=E('播放列表','Playlist')+' · '+rows.length;
  playlistNotice.textContent=rows.length?E('点击续播 · 删除录像后自动移除','Click to resume · Deleted recordings disappear'):E('播放过的录像会保留在这里。','Recordings you play will appear here.');
  playlistList.replaceChildren();
  for(const row of rows){
    const button=document.createElement('button');button.type='button';button.className='player-playlist-item';button.dataset.recordingId=row.id;
    const current=row.parts.includes(finalId);button.classList.toggle('current',current);if(current)button.setAttribute('aria-current','true');
    const title=document.createElement('span');title.className='playlist-title';title.textContent=row.entry.name;
    const detail=document.createElement('span');detail.className='playlist-detail';
    const seconds=Math.floor((row.entry.duration||0)/1000);detail.textContent=(current?E('正在观看 · ','Now watching · '):'')+Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0')+(row.entry._parts?E(' · '+row.parts.length+' 段连续播放',' · '+row.parts.length+' continuous parts'):'');
    button.append(title,detail);button.onclick=async()=>{button.disabled=true;try{const fresh=(await readStore('recordings')).filter(e=>!e.deletedAt);const entry=recordingGroups(fresh).find(e=>e.id===row.id||(e._parts||[]).some(p=>row.parts.includes(p.id)));if(!entry){await refreshPlayerPlaylist();return;}await playRecording(entry);playlistMenu.open=false;}catch(error){playlistNotice.textContent=error.message;}finally{button.disabled=false;}};
    playlistList.append(button);
  }
}
playlistChannel?.addEventListener('message',()=>refreshPlayerPlaylist().catch(showPlaylistError));
window.addEventListener('DOMContentLoaded',()=>refreshPlayerPlaylist().catch(showPlaylistError));
window.addEventListener('wescreen-language',()=>{playlistSummary.title=E('播放列表','Playlist');playlistSummary.setAttribute('aria-label',playlistSummary.title);refreshPlayerPlaylist().catch(showPlaylistError);});
window.addEventListener('pagehide',()=>playlistChannel?.close());
