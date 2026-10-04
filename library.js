// Recording records are the single source of truth for library and course views.
let libraryTrash = false, libraryPage = 0;
const LIBRARY_PAGE_SIZE = 50;
const librarySelection = new Set();
async function updateRecording(id, changes) {
  await runTx('recordings', 'readwrite', tx => {
    const store = tx.objectStore('recordings'), request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...changes }); };
  });
  if (typeof notifyPlaybackLibraryChanged === 'function') notifyPlaybackLibraryChanged();
}
async function removeRecordings(ids, permanent = false) {
  if (!ids.length) return;
  const groups=recordingGroups(await readStore('recordings'));ids=[...new Set(ids.flatMap(id=>groups.find(e=>e.id===id)?._parts?.map(e=>e.id)||[id]))];
  if(!permanent && typeof playerLastDeleted!=='undefined')playerLastDeleted=(await readStore('recordings')).filter(e=>ids.includes(e.id)).map(e=>({id:e.id,deletedAt:e.deletedAt}));
  if (permanent && !confirm(L('confirmPermanent', ids.length))) return;
  await runTx(['recordings', 'videos'], 'readwrite', tx => {
    for (const id of ids) {
      if (permanent) { tx.objectStore('recordings').delete(id); tx.objectStore('videos').delete(id); }
      else { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => { if (request.result) tx.objectStore('recordings').put({ ...request.result, deletedAt: Date.now() }); }; }
    }
  });
  if (typeof notifyPlaybackLibraryChanged === 'function') notifyPlaybackLibraryChanged();
  for(const id of ids)playbackBlobCache.delete(id);
  if(ids.includes(playbackNextPart?.id))playbackNextPart=null;
  if (ids.includes(finalId)) { clearPreview(); finalBlob = null; finalId = null; finalSize = 0; recordingView = 'setup'; navigateWorkspace(workspaceView); }
  librarySelection.clear(); await renderRecordingLibrary(); renderStorageHint();
}
function libraryButton(label, action, kind = 'quiet') {
  const button = document.createElement('button'); button.type = 'button'; button.className = kind; button.textContent = L(label);
  button.onclick = async () => { button.disabled = true; try { await action(); } catch (error) { $(workspaceView === 'tasks' ? 'tasks-status' : 'library-status').textContent = error.message; } finally { button.disabled = false; } };
  return button;
}
// Group metadata without changing or concatenating the original video blobs.
function recordingGroups(entries) {
  const groups=[], explicit=new Map();
  const original=entries.filter(e=>!e.enhancedFrom).sort((a,b)=>a.createdAt-b.createdAt);
  for(const entry of original){
    const match=entry.name.match(/-part-(\d+)(?=\.(?:mp4|webm)$)/i);
    const part=entry.part || (match ? Number(match[1]):1);
    const base=entry.name.replace(/-part-\d+(?=\.(?:mp4|webm)$)/i,'');
    let group=entry.recordingGroupId ? explicit.get(entry.recordingGroupId):null;
    if(!group && !entry.recordingGroupId && part>1){group=groups.findLast(g=>!g[0].recordingGroupId && g[0].name.replace(/-part-\d+(?=\.(?:mp4|webm)$)/i,'')===base && (g.at(-1).part || Number(g.at(-1).name.match(/-part-(\d+)/)?.[1]) || 1)===part-1 && g[0].channelId===entry.channelId && g[0].width===entry.width && g[0].height===entry.height && entry.createdAt-g.at(-1).createdAt <= (entry.duration || 0)+120000);}
    if(!group){group=[];groups.push(group);if(entry.recordingGroupId)explicit.set(entry.recordingGroupId,group);}group.push(entry);
  }
  return groups.map(parts=>{parts.sort((a,b)=>(a.part || Number(a.name.match(/-part-(\d+)/)?.[1]) || 1)-(b.part || Number(b.name.match(/-part-(\d+)/)?.[1]) || 1));const first=parts[0];return parts.length===1 ? first:{...first,name:first.name.replace(/-part-\d+(?=\.(?:mp4|webm)$)/i,''),_parts:parts,duration:parts.reduce((n,e)=>n+(e.duration||0),0),size:parts.reduce((n,e)=>n+e.size,0)};}).concat(entries.filter(e=>e.enhancedFrom));
}
let playbackParts=[],playbackPartIndex=0,partLoadGeneration=0,playbackNextPart=null;
const playbackBlobCache=new Map();
function cachedPlaybackBlob(id){if(!playbackBlobCache.has(id)){const pending=readStore('videos',id);playbackBlobCache.set(id,pending);pending.catch(()=>{if(playbackBlobCache.get(id)===pending)playbackBlobCache.delete(id);});while(playbackBlobCache.size>3)playbackBlobCache.delete(playbackBlobCache.keys().next().value);}return playbackBlobCache.get(id);}
function preloadRecordingPart(){const next=playbackParts[playbackPartIndex+1];playbackNextPart=next ? {id:next.id,blob:cachedPlaybackBlob(next.id)}:null;playbackNextPart?.blob.catch(()=>{});}

function playbackTimelineTotal(){return playbackParts.length>1 ? playbackParts.reduce((n,e)=>n+(e.duration||0)/1000,0):Number.isFinite($('preview').duration)?$('preview').duration:0;}
function playbackTimelineTime(){return playbackParts.slice(0,playbackPartIndex).reduce((n,e)=>n+(e.duration||0)/1000,0)+$('preview').currentTime;}
async function seekRecordingTimeline(time,playing=!$('preview').paused){
 const total=playbackTimelineTotal();time=Math.max(0,Math.min(time,total));let index=0,offset=0;
 while(index<playbackParts.length-1 && time>=offset+(playbackParts[index].duration||0)/1000){offset+=(playbackParts[index].duration||0)/1000;index++;}
 if(index===playbackPartIndex){partLoadGeneration++;$('preview').currentTime=Math.max(0,time-offset);return;}
 await loadRecordingPart(index,time-offset,playing);
}
async function loadRecordingPart(index,time=null,playing=false){
 const generation=++partLoadGeneration,entry=playbackParts[index];if(!entry)return;
 const current=await readStore('recordings',entry.id);if(generation!==partLoadGeneration)return;if(!current || current.deletedAt){playbackBlobCache.delete(entry.id);throw new Error(E('此录像已删除。','This recording was deleted.'));}
 const blob=await (playbackNextPart?.id===entry.id ? playbackNextPart.blob:cachedPlaybackBlob(entry.id));if(generation!==partLoadGeneration)return;if(!blob)throw new Error(L('errEmpty'));
 const view=playbackReady?currentPlaybackView():null;const rotation=typeof playbackRotation==='number'?playbackRotation:0,speed=$('preview').playbackRate;
 playbackPartIndex=index;preloadRecordingPart();finalBlob=blob;finalSize=blob.size;finalId=entry.id;finalName=entry.name;finalDuration=playbackTimelineTotal()*1000;finalMarkers=entry.markers||[];
 if(time!==null)pendingPlaybackPosition={id:entry.id,time,playing,view};setPreview(blob);
 if(playbackParts.length>1){$('playback-name').textContent=playbackParts[0].name.replace(/-part-\d+(?=\.(?:mp4|webm)$)/i,'')+' · '+(index+1)+' / '+playbackParts.length;$('preview').addEventListener('loadedmetadata',()=>{setPlaybackRotation(rotation);$('preview').playbackRate=speed;$('playback-speed').value=String(speed);},{once:true});}
}
async function playRecording(entry) {
  if(typeof savePlaybackState==='function')savePlaybackState();
  const all=(await readStore('recordings')).filter(e=>!e.deletedAt);
  const group=recordingGroups(all).find(e=>e.id===entry.id || e._parts?.some(p=>p.id===entry.id));
  if (!group) throw new Error(E('此录像已删除。','This recording was deleted.'));
  playbackBlobCache.clear();playbackParts=group?._parts || [entry];playbackPartIndex=0;
  const resume=playbackParts.length>1 ? await readStore('meta','continuous:'+(playbackParts[0].recordingGroupId || playbackParts[0].id)):null;
  await loadRecordingPart(resume && playbackParts.some(e=>e.id===resume.partId) ? playbackParts.findIndex(e=>e.id===resume.partId):0,resume?.time ?? null);
  renderRecordingReview(playbackParts[0]).catch(error=>$('review-summary').textContent=error.message);$('result-warning').hidden=true;show('result');
  if (typeof rememberPlaylistRecording === 'function') await rememberPlaylistRecording(group).catch(error => {
    $('playback-status').textContent=E('录像已打开，但播放列表保存失败，请检查存储空间。','Recording opened, but playlist could not be saved. Check available storage.');
  });
}
async function renderRecordingLibrary() {
  const generation = ++libraryRenderGeneration;
  const all = await readStore('recordings');
  if (generation !== libraryRenderGeneration) return;
  renderCourseLibrary(all);
  const active = all.filter(entry => Boolean(entry.deletedAt) === libraryTrash);
  const courseSelect = $('library-course'), selectedCourse = courseSelect.value; courseSelect.replaceChildren();
  const choices = [{ value: '', text: L('allCollections') }];
  for (const entry of active) { const value = entry.channelId ? `channel:${entry.channelId}` : entry.course; if (value && !choices.some(option => option.value === value)) choices.push({ value, text: entry.channelId ? telegramProfiles.find(profile => profile.id === entry.channelId)?.name || entry.channelName : entry.course }); }
  for (const choice of choices) { const option = document.createElement('option'); option.value = choice.value; option.textContent = choice.text; courseSelect.append(option); }
  courseSelect.value = [...courseSelect.options].some(option => option.value === selectedCourse) ? selectedCourse : '';
  const query = $('library-search').value.trim().toLocaleLowerCase();
  const entries = recordingGroups(active).filter(entry => (!$('library-kind').value || ($('library-kind').value==='enhanced' ? !!entry.enhancedFrom : !entry.enhancedFrom)) && (!courseSelect.value || (courseSelect.value.startsWith('channel:') ? entry.channelId === courseSelect.value.slice(8) : !entry.channelId && entry.course === courseSelect.value)) && `${entry.name} ${entry.course || ''}`.toLocaleLowerCase().includes(query));
  const sort = $('library-sort')?.value || 'newest';
  entries.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size-a.size : b.createdAt-a.createdAt);
  if ($('library-group').checked) {
    const byId = new Map(entries.map(entry => [entry.id, entry])), ordered = [], seen = new Set();
    const messages=new Map();for(const entry of entries)if(!entry.enhancedFrom && entry.sourceMessageKey){const root=messages.get(entry.sourceMessageKey);if(root)entry._messageParent=root.id;else messages.set(entry.sourceMessageKey,entry);}
    const append = entry => { if (seen.has(entry.id)) return; seen.add(entry.id); ordered.push(entry); for (const child of entries) if (child.enhancedFrom === entry.id || child._messageParent===entry.id) append(child); };
    for (const entry of entries) { let root = byId.get(entry._messageParent) || entry, ancestry = new Set([root.id]); while(byId.has(root.enhancedFrom || root._messageParent) && !ancestry.has(root.enhancedFrom || root._messageParent)){root=byId.get(root.enhancedFrom || root._messageParent);ancestry.add(root.id);} append(root); }
    entries.splice(0, entries.length, ...ordered);
  }
  const pageCount = Math.max(1, Math.ceil(entries.length / LIBRARY_PAGE_SIZE)); libraryPage = Math.min(libraryPage, pageCount - 1);
  const visibleEntries = entries.slice(libraryPage * LIBRARY_PAGE_SIZE, (libraryPage + 1) * LIBRARY_PAGE_SIZE);
  $('library-page').textContent = `${libraryPage + 1} / ${pageCount}`; $('library-prev').disabled = libraryPage === 0; $('library-next').disabled = libraryPage >= pageCount - 1;
  const entryIds = new Set(visibleEntries.map(entry => entry.id));
  for (const id of librarySelection) if (!entryIds.has(id)) librarySelection.delete(id);
  $('library-total').textContent = L('libraryTotal', recordingGroups(active).length, fmtBytes(all.reduce((n,e) => n+e.size,0)));
  $('library-empty').textContent = L(active.length ? 'noMatches' : libraryTrash ? 'trashEmpty' : 'libraryEmpty');
  $('library-empty').hidden = entries.length > 0; $('library-status').textContent = '';
  $('library-trash').textContent = L(libraryTrash ? 'backLibrary' : 'trash');
  const list = $('recording-items'); list.replaceChildren();
  for (const entry of visibleEntries) {
    const row = document.createElement('li'); row.className = 'media-row' + ((entry.enhancedFrom || entry._messageParent) && $('library-group').checked ? ' derived-row' : ''); row.dataset.recordingId = entry.id;
    const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'row-select'; check.checked = librarySelection.has(entry.id); check.setAttribute('aria-label', L('selectRecording', entry.name));
    check.onchange = () => { if (check.checked) librarySelection.add(entry.id); else librarySelection.delete(entry.id); updateLibrarySelection(); }; row.append(check);
    const image = document.createElement('img'); image.src = entry.thumbnail || 'assets/logo.png'; image.alt = ''; image.className = 'recording-thumbnail'; const thumbnail=document.createElement('button');thumbnail.type='button';thumbnail.className='thumbnail-play';thumbnail.setAttribute('aria-label',L('openRecording')+' '+entry.name);thumbnail.onclick=()=>playRecording(entry).catch(workspaceError);thumbnail.append(image);const overlay=document.createElement('span');overlay.className='thumbnail-overlay';overlay.textContent='▶';thumbnail.append(overlay);const duration=document.createElement('span');duration.className='thumbnail-duration';duration.textContent=entry.duration ? fmt(entry.duration) : '--:--';thumbnail.append(duration);row.append(thumbnail);
    const body = document.createElement('div'); body.className = 'media-body';
    const title = document.createElement('strong'); title.textContent = entry.sourceTitle || entry.name.replace(/\.(mp4|webm)$/i,''); body.append(title);
    const badge=document.createElement('span');badge.className='recording-badge'+(entry.enhancedFrom ? ' enhanced-badge':'');badge.textContent=L(entry.enhancedFrom ? 'enhancedBadge':'originalBadge');title.append(badge);if(entry._parts){const count=document.createElement('span');count.className='recording-badge';count.textContent=LANG==='zh'?`连续录像 · ${entry._parts.length} 段`:`Continuous · ${entry._parts.length} parts`;title.append(count);}
    if(entry._messageParent){const take=document.createElement('span');take.className='recording-badge';take.textContent=E('同一消息 · 重录版','Same message · another take');title.append(take);}
    if(entry.inspection){const note=document.createElement('p');note.className='hint';note.textContent=inspectionLabel(entry.inspection);body.append(note);}
    const filename=document.createElement('p');filename.className='recording-filename hint';filename.textContent=entry.name;body.append(filename);
    const detail = document.createElement('p'); detail.className = 'hint'; detail.textContent = `${entry.duration ? fmt(entry.duration) : '--:--'} · ${entry.width && entry.height ? `${entry.width}×${entry.height} · ` : ''}${fmtBytes(entry.size)} · ${entry.course || L('uncategorized')} · ${new Date(entry.createdAt).toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en')}`; body.append(detail);
    if (entry.enhancedFrom) { const parent = all.find(item => item.id === entry.enhancedFrom); if (parent && !parent.deletedAt) { const original=libraryButton('originalVideo',()=>playRecording(parent),'text');original.classList.add('original-link');detail.append(' · ',original); } else { const version=document.createElement('p');version.className='version-label';version.textContent=L('originalUnavailable');body.append(version); } }

    const location = document.createElement('p'); location.className = 'hint recording-location'; location.textContent = entry.diskName ? E('磁盘同步：','Disk copy: ')+entry.diskName+' · '+L('localLocation'):L('localLocation'); body.append(location);
    if (entry.downloadPath) { const path = document.createElement('p'); path.className = 'hint recording-location'; path.textContent = L(entry.downloadExists === false ? 'missingDownload' : 'downloadedLocation', entry.downloadPath); body.append(path); }
    if (entry.sourceUrl) { const link = document.createElement('a'); link.href = telegramLink(entry.sourceUrl); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = L('sourceMessage'); body.append(link); }
    const actions = document.createElement('div'); actions.className = 'controls media-actions';
    if (libraryTrash) {
      actions.append(libraryButton('restore', async () => { for(const part of entry._parts || [entry])await updateRecording(part.id,{ deletedAt: null }); await renderRecordingLibrary(); }));
      actions.append(libraryButton('deletePermanently', () => removeRecordings([entry.id],true), 'danger'));
    } else {
      actions.append(libraryButton('openRecording', () => playRecording(entry), 'primary'));
      if(!entry._parts)actions.append(libraryButton('enhanceRecording', () => openEnhancement(entry)));
      if(entry._parts){const parts=document.createElement('details');parts.className='recording-parts';const summary=document.createElement('summary');summary.textContent=LANG==='zh'?'分段文件与单独处理':'Parts and individual processing';parts.append(summary);for(const part of entry._parts){const line=document.createElement('div');line.className='controls';const label=document.createElement('span');label.textContent=part.name;line.append(label,libraryButton('enhanceRecording',()=>openEnhancement(part)),libraryButton('btnDownload',async()=>download(await readStore('videos',part.id),part.name,part.id)));parts.append(line);}body.append(parts);}
      const menu = document.createElement('details'); menu.className = 'row-menu'; const summary = document.createElement('summary'); summary.textContent = '⋯';summary.setAttribute('aria-label',L('more')); menu.append(summary);
      const items = document.createElement('div'); items.className = 'menu-items';
      if(entry.diskHandle)items.append(libraryButton('btnDownload',async()=>{if(await entry.diskHandle.requestPermission({mode:'read'})!=='granted')throw new Error(E('未授权磁盘文件','Disk file not authorized'));download(await entry.diskHandle.getFile(),entry.diskName,entry.id);}));
      if(!entry._parts)items.append(libraryButton('btnDownload', async () => { const blob = await readStore('videos',entry.id); download(blob,entry.name,entry.id); }));
      if(!entry._parts)items.append(libraryButton('editVideo', () => openVideoEditor(entry)));
      if(!entry._parts)items.append(libraryButton('renameRecording', async () => {
        const input = prompt(L('renamePrompt'),entry.name.replace(/\.(mp4|webm)$/i,'')); if (!input?.trim()) return;
        const name = input.trim().replace(/[\\/:*?"<>|]/g,'-').replace(/\.(mp4|webm)$/i,'').slice(0,120)+(entry.name.endsWith('.mp4') ? '.mp4' : '.webm');
        await updateRecording(entry.id,{name}); if (finalId === entry.id) finalName = name; await renderRecordingLibrary();
      }));
      if (entry.downloadId !== undefined) items.append(libraryButton('showFolder', async () => {
        const [item] = await chrome.downloads.search({id:entry.downloadId});
        if (!item || item.exists === false || item.state === 'interrupted') { await updateRecording(entry.id,{downloadExists:false}); throw new Error(L('downloadMissing')); }
        await chrome.downloads.show(entry.downloadId);
      }));
      if (entry.downloadPath) items.append(libraryButton('copyPath', () => navigator.clipboard.writeText(entry.downloadPath)));
      items.append(libraryButton('deleteRecording', () => removeRecordings([entry.id])));
      menu.append(items); actions.append(menu);
    }
    row.append(body,actions); list.append(row);
  }
  updateLibrarySelection();
}
function updateLibrarySelection() {
  $('library-selection-count').textContent=librarySelection.size ? L('selectedCount',librarySelection.size) : L('selectAll');
  $('bulk-hint').hidden=librarySelection.size>0;
  $('batch-add').disabled = !librarySelection.size || libraryTrash;$('bulk-delete').disabled = !librarySelection.size; $('bulk-restore').disabled = !librarySelection.size; $('bulk-restore').hidden = !libraryTrash;
  $('bulk-delete').textContent = L(libraryTrash ? 'deletePermanently' : 'moveTrash') + (librarySelection.size ? ` (${librarySelection.size})` : '');
  const checks = [...document.querySelectorAll('.row-select')]; $('select-all').checked = Boolean(checks.length && checks.every(check => check.checked));
}
async function importRecording(file) {
  if (!file || !/\.(mp4|webm)$/i.test(file.name)) throw new Error(L('importFormat'));
  if (file.size > HEAP_LIMIT_BYTES) throw new Error(L('importTooLarge'));
  const url = URL.createObjectURL(file), video = document.createElement('video');
  try {
    const info = await new Promise((resolve,reject) => {
      const timeout = setTimeout(() => reject(new Error(L('errNoSource'))),10000);
      video.onloadeddata = () => { clearTimeout(timeout); resolve({ width:video.videoWidth,height:video.videoHeight,duration:Number.isFinite(video.duration) ? video.duration*1000 : 0 }); };
      video.onerror = () => { clearTimeout(timeout); reject(new Error(L('errNoSource'))); }; video.muted = true; video.preload = 'auto'; video.src = url;
    });
    const id = crypto.randomUUID(), entry = { id,name:file.name,size:file.size,createdAt:Date.now(),markers:[],course:'',...info };
    await runTx(['recordings','videos'],'readwrite',tx => { tx.objectStore('recordings').add(entry); tx.objectStore('videos').add(file,id); });
    saveThumbnail(file,id).catch(()=>{}); libraryTrash = false; await renderRecordingLibrary(); navigateWorkspace('library');
  } finally { video.removeAttribute('src');video.load();URL.revokeObjectURL(url); }
}

window.addEventListener('pagehide',()=>{playbackBlobCache.clear();playbackNextPart=null;});
