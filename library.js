// Recording records are the single source of truth for library and course views.
let libraryTrash = false, libraryPage = 0;
const LIBRARY_PAGE_SIZE = 50;
const librarySelection = new Set();
async function updateRecording(id, changes) {
  await runTx('recordings', 'readwrite', tx => {
    const store = tx.objectStore('recordings'), request = store.get(id);
    request.onsuccess = () => { if (request.result) store.put({ ...request.result, ...changes }); };
  });
}
async function removeRecordings(ids, permanent = false) {
  if (!ids.length) return;
  if (permanent && !confirm(L('confirmPermanent', ids.length))) return;
  await runTx(['recordings', 'videos'], 'readwrite', tx => {
    for (const id of ids) {
      if (permanent) { tx.objectStore('recordings').delete(id); tx.objectStore('videos').delete(id); }
      else { const request = tx.objectStore('recordings').get(id); request.onsuccess = () => { if (request.result) tx.objectStore('recordings').put({ ...request.result, deletedAt: Date.now() }); }; }
    }
  });
  if (ids.includes(finalId)) { clearPreview(); finalBlob = null; finalId = null; finalSize = 0; recordingView = 'setup'; navigateWorkspace(workspaceView); }
  librarySelection.clear(); await renderRecordingLibrary(); renderStorageHint();
}
function libraryButton(label, action, kind = 'quiet') {
  const button = document.createElement('button'); button.type = 'button'; button.className = kind; button.textContent = L(label);
  button.onclick = async () => { button.disabled = true; try { await action(); } catch (error) { $(workspaceView === 'tasks' ? 'tasks-status' : 'library-status').textContent = error.message; } finally { button.disabled = false; } };
  return button;
}
async function playRecording(entry) {
  const blob = await readStore('videos', entry.id); if (!blob) throw new Error(L('errEmpty'));
  finalBlob = blob; finalSize = blob.size; finalName = entry.name; finalId = entry.id; finalMarkers = entry.markers || []; finalDuration = entry.duration || 0;
  setPreview(blob); $('result-warning').hidden = true; show('result');
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
  const entries = active.filter(entry => (!courseSelect.value || (courseSelect.value.startsWith('channel:') ? entry.channelId === courseSelect.value.slice(8) : !entry.channelId && entry.course === courseSelect.value)) && `${entry.name} ${entry.course || ''}`.toLocaleLowerCase().includes(query));
  const sort = $('library-sort')?.value || 'newest';
  entries.sort((a,b) => sort === 'name' ? a.name.localeCompare(b.name) : sort === 'size' ? b.size-a.size : b.createdAt-a.createdAt);
  if ($('library-group').checked) {
    const byId = new Map(entries.map(entry => [entry.id, entry])), ordered = [], seen = new Set();
    const append = entry => { if (seen.has(entry.id)) return; seen.add(entry.id); ordered.push(entry); for (const child of entries) if (child.enhancedFrom === entry.id) append(child); };
    for (const entry of entries) { let root = entry, ancestry = new Set([root.id]); while (byId.has(root.enhancedFrom) && !ancestry.has(root.enhancedFrom)) { root = byId.get(root.enhancedFrom); ancestry.add(root.id); } append(root); }
    entries.splice(0, entries.length, ...ordered);
  }
  const pageCount = Math.max(1, Math.ceil(entries.length / LIBRARY_PAGE_SIZE)); libraryPage = Math.min(libraryPage, pageCount - 1);
  const visibleEntries = entries.slice(libraryPage * LIBRARY_PAGE_SIZE, (libraryPage + 1) * LIBRARY_PAGE_SIZE);
  $('library-page').textContent = `${libraryPage + 1} / ${pageCount}`; $('library-prev').disabled = libraryPage === 0; $('library-next').disabled = libraryPage >= pageCount - 1;
  const entryIds = new Set(visibleEntries.map(entry => entry.id));
  for (const id of librarySelection) if (!entryIds.has(id)) librarySelection.delete(id);
  $('library-total').textContent = L('libraryTotal', active.length, fmtBytes(all.reduce((n,e) => n+e.size,0)));
  $('library-empty').textContent = L(active.length ? 'noMatches' : libraryTrash ? 'trashEmpty' : 'libraryEmpty');
  $('library-empty').hidden = entries.length > 0; $('library-status').textContent = '';
  $('library-trash').textContent = L(libraryTrash ? 'backLibrary' : 'trash');
  const list = $('recording-items'); list.replaceChildren();
  for (const entry of visibleEntries) {
    const row = document.createElement('li'); row.className = 'media-row' + (entry.enhancedFrom && $('library-group').checked ? ' derived-row' : ''); row.dataset.recordingId = entry.id;
    const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'row-select'; check.checked = librarySelection.has(entry.id); check.setAttribute('aria-label', L('selectRecording', entry.name));
    check.onchange = () => { if (check.checked) librarySelection.add(entry.id); else librarySelection.delete(entry.id); updateLibrarySelection(); }; row.append(check);
    const image = document.createElement('img'); image.src = entry.thumbnail || 'assets/logo.png'; image.alt = ''; image.className = 'recording-thumbnail'; row.append(image);
    const body = document.createElement('div'); body.className = 'media-body';
    const title = document.createElement('strong'); title.textContent = entry.name; body.append(title);
    const detail = document.createElement('p'); detail.className = 'hint'; detail.textContent = `${entry.duration ? fmt(entry.duration) : '--:--'} · ${entry.width && entry.height ? `${entry.width}×${entry.height} · ` : ''}${fmtBytes(entry.size)} · ${entry.course || L('uncategorized')} · ${new Date(entry.createdAt).toLocaleDateString(LANG === 'zh' ? 'zh-CN' : 'en')}`; body.append(detail);
    if (entry.enhancedFrom) { const parent = all.find(item => item.id === entry.enhancedFrom); const version = document.createElement('p'); version.className = 'version-label'; version.textContent = L('derivedVersion', parent?.name || L('originalUnavailable')); body.append(version); if (parent && !parent.deletedAt) body.append(libraryButton('originalVideo', () => playRecording(parent), 'text')); }
    const location = document.createElement('p'); location.className = 'hint recording-location'; location.textContent = L('localLocation'); body.append(location);
    if (entry.downloadPath) { const path = document.createElement('p'); path.className = 'hint recording-location'; path.textContent = L(entry.downloadExists === false ? 'missingDownload' : 'downloadedLocation', entry.downloadPath); body.append(path); }
    if (entry.sourceUrl) { const link = document.createElement('a'); link.href = telegramLink(entry.sourceUrl); link.target = '_blank'; link.rel = 'noopener noreferrer'; link.textContent = L('sourceMessage'); body.append(link); }
    const actions = document.createElement('div'); actions.className = 'controls media-actions';
    if (libraryTrash) {
      actions.append(libraryButton('restore', async () => { await updateRecording(entry.id,{ deletedAt: null }); await renderRecordingLibrary(); }));
      actions.append(libraryButton('deletePermanently', () => removeRecordings([entry.id],true), 'danger'));
    } else {
      actions.append(libraryButton('openRecording', () => playRecording(entry), 'primary'));
      actions.append(libraryButton('enhanceRecording', () => openEnhancement(entry)));
      const menu = document.createElement('details'); menu.className = 'row-menu'; const summary = document.createElement('summary'); summary.textContent = L('more'); menu.append(summary);
      const items = document.createElement('div'); items.className = 'menu-items';
      items.append(libraryButton('btnDownload', async () => { const blob = await readStore('videos',entry.id); download(blob,entry.name,entry.id); }));
      items.append(libraryButton('editVideo', () => openVideoEditor(entry)));
      items.append(libraryButton('renameRecording', async () => {
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
    body.append(actions); row.append(body); list.append(row);
  }
  updateLibrarySelection();
}
function updateLibrarySelection() {
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
