// Studio layout adapts existing controls; recording, storage and media engines stay authoritative.
(() => {
  document.body.classList.add('studio-ui');
  const make = (tag, cls) => { const node=document.createElement(tag);node.className=cls;return node; };
  const form=document.querySelector('.setup-form'), columns=document.querySelector('.setup-columns');
  const stage=make('div','studio-source'), settings=make('aside','studio-record-settings');
  const picker=document.querySelector('.scenario-picker'), ready=document.querySelector('.capture-ready');
  stage.append(picker);
  document.querySelector('[data-view=capture]').addEventListener('click',()=>{if(!recorder && !displayStream && $('capture-mode').value!=='general'){$('capture-mode').value='general';$('filename').value='wescreen-recording';applyCapturePreset();}});
  const source=make('div','studio-source-empty');
  source.append(ready);stage.append(source);
  const footer=make('div','studio-source-footer');
  for(const node of [document.querySelector('.capture-compatibility'),$('notice'),document.querySelector('.capture-start-row')])if(node)footer.append(node);
  stage.append(footer);
  // Keep the guide and shared Telegram controls in the setup form for workspace navigation.
  const channelFields=make('div','studio-channel-fields');
  for(const id of ['telegram-guide','telegram-channel','course-panel'])channelFields.append($(id));
  stage.insertBefore(channelFields,source);
  const title=make('h3','studio-settings-title');settings.append(title);
  settings.append($('filename').closest('label'));
  const quality=document.querySelector('.record-quality-grid');settings.append(quality);
  settings.append($('record-summary'));
  if($('capture-resolution-help'))settings.append($('capture-resolution-help'));
  const advanced=$('record-advanced');
  const frame=$('framerate')?.closest('label');if(frame)quality.append(frame);
  const options=document.querySelector('.record-options');settings.append(options);
  for(const id of ['camera','clicks']){const field=$(id)?.closest('label');if(field)advanced.append(field);}
  settings.append(advanced);
  // Preserve any dynamically installed capture options instead of leaving them in a detached form.
  for(const node of [...form.children])if(!node.matches('.sr-only'))settings.append(node);
  stage.prepend($('capture-mode').closest('label'));columns.replaceChildren(stage,settings);

  const actions=make('div','studio-view-switch');actions.setAttribute('role','group');
  const buttons=['rows','cards'].map(value=>{const button=make('button','quiet');button.type='button';button.dataset.libraryLayout=value;button.onclick=()=>setLayout(value);actions.append(button);return button;});
  document.querySelector('.library-toolbar').append(actions);
  let layout='rows';try{layout=localStorage.getItem('wescreen-library-layout')==='cards'?'cards':'rows';}catch{}
  function setLayout(value){layout=value;$('recording-items').dataset.layout=value;buttons.forEach(button=>button.setAttribute('aria-pressed',String(button.dataset.libraryLayout===value)));try{localStorage.setItem('wescreen-library-layout',value);}catch{}}
  setLayout(layout);
  // Collapse related versions into their original row without replacing action handlers.
  const list=$('recording-items');let grouping=false;
  const expanded=new Set();
  function groupRows(){if(grouping || !$('library-group').checked)return;grouping=true;
    const rows=[...list.querySelectorAll(':scope > .media-row')], byId=new Map(rows.map(row=>[row.dataset.recordingId,row]));
    for(const row of rows){const parent=byId.get(row.dataset.parentId);if(!parent || parent===row || row.contains(parent))continue;
      let details=parent.querySelector(':scope > .studio-versions');
      if(!details){details=make('details','studio-versions');details.dataset.root=parent.dataset.recordingId;const summary=make('summary','');details.append(summary);details.open=expanded.has(details.dataset.root);details.addEventListener('toggle',()=>{if(details.open)expanded.add(details.dataset.root);else expanded.delete(details.dataset.root);});parent.append(details);}
      details.append(row);if(row.querySelector('.row-select')?.checked)details.open=true;
      details.firstElementChild.textContent=E('查看修复与其他版本','Restored & alternate versions')+' · '+details.querySelectorAll('.media-row').length;
    } grouping=false;
  }
  new MutationObserver(groupRows).observe(list,{childList:true});
  document.querySelector('.bulk-controls').classList.add('studio-selection');
  const selection=()=>document.querySelector('.bulk-controls').classList.toggle('has-selection',librarySelection.size>0);
  list.addEventListener('change',selection);$('select-all').addEventListener('change',selection);new MutationObserver(selection).observe($('library-selection-count'),{childList:true});

  const dialog=$('enhance-panel');const head=dialog.querySelector('.section-head');
  const workspace=make('div','studio-repair-workspace'),parameters=make('aside','studio-repair-parameters'),comparison=make('div','studio-repair-preview'),bottom=make('div','studio-repair-footer');
  for(const node of [document.querySelector('.enhance-settings'),$('enhance-mode-hint'),$('enhancement-face-controls'),$('enhance-output-options'),$('enhance-model-availability'),$('enhance-model-setup'),$('enhance-disabled-reason'),$('helper-actions'),$('helper-help'),$('helper-status'),$('helper-connection')])if(node)parameters.append(node);
  const compare=dialog.querySelector('.enhance-comparison');if(compare)comparison.append(compare);
  const fine=$('enhance-zoom')?.closest('details');if(fine)comparison.append(fine);
  for(const node of [...dialog.children])if(node!==head && !node.matches('[data-i18n=enhanceDisclaimer]'))bottom.append(node);
  workspace.append(parameters,comparison);dialog.append(workspace,bottom);
  const refresh=()=>{title.textContent=E('录制设置','Recording settings');buttons[0].textContent=E('列表','List');buttons[1].textContent=E('网格','Grid');actions.setAttribute('aria-label',E('录像库布局','Library layout'));};
  window.addEventListener('wescreen-language',refresh);refresh();
})();

// Recording workbench; all original media/control nodes keep their handlers.
(() => {
 const recording=$('recording'),head=recording.querySelector('.record-head');
 const make=(tag,cls)=>{const el=document.createElement(tag);el.className=cls;return el;};
 const heading=make('div','recording-console-title'),title=document.createElement('strong'),caption=document.createElement('span');heading.append(title,caption);head.prepend(heading);
 const status=make('div','recording-console-status');status.append(head.querySelector('.live'));head.querySelector('#timer').before(status);status.append($('timer'));head.append(status);
 const stage=make('div','recording-preview-stage');$('live-preview').before(stage);stage.append($('live-preview'));
 const dock=make('div','recording-control-dock'),transport=make('div','recording-transport');
 for(const id of ['pause','stop','mark','capture-monitor-live'])transport.append($(id));
 const audio=recording.querySelector('.source-status label'),db=document.createElement('span');db.className='recording-db';db.textContent='−∞ dB';audio.append(db);
 const secondary=make('details','recording-secondary'),tools=document.createElement('summary');tools.textContent='⋯';secondary.append(tools);
 for(const id of ['next-channel-video','copy-next-message','floating-controls'])secondary.append($(id));
 const diagnostics=make('details','recording-diagnostics'),summary=document.createElement('summary');diagnostics.append(summary);
 for(const id of ['recording-health','capture-quality-stats'])diagnostics.append($(id));secondary.append(diagnostics);
 const source=recording.querySelector('.source-status');head.append($('source-info'));source.remove();
 recording.querySelector(':scope > .controls')?.remove();dock.append(transport,audio,$('memory'),secondary);stage.after(dock);
 const sizePreview=()=>{const video=$('live-preview');if(video.videoWidth&&video.videoHeight)stage.style.setProperty('--recording-preview-width',(Math.max(220,window.innerHeight*.62)*video.videoWidth/video.videoHeight)+'px');};
 $('live-preview').addEventListener('loadedmetadata',sizePreview);window.addEventListener('resize',sizePreview);
 const footer=make('div','recording-console-footer'),local=document.createElement('span'),original=document.createElement('span');footer.append(local,original);dock.after(footer);$('recording-hint').hidden=true;
 const sync=()=>{status.dataset.paused=String(typeof recorder!=='undefined'&&recorder?.state==='paused');status.querySelector('.live').textContent=E(status.dataset.paused==='true'?'已暂停':'正在录制',status.dataset.paused==='true'?'Paused':'Recording');title.textContent=E('录制工作台','Recording studio');caption.textContent=$('filename').value || E('本机录制','Local recording');local.textContent=E('● 本机保存','● Saved locally');original.textContent=E('原视频保留','Originals preserved');summary.textContent=E('录制诊断','Recording diagnostics');tools.title=E('更多录制工具','Recording tools');tools.setAttribute('aria-label',tools.title);for(const id of ['pause','stop','mark','capture-monitor-live']){const button=$(id);button.title=button.textContent;button.setAttribute('aria-label',button.textContent);if(id==='pause')button.dataset.paused=String(typeof recorder!=='undefined'&&recorder?.state==='paused');}db.textContent=$('live-level').value>0 ? (20*Math.log10($('live-level').value/4)).toFixed(0)+' dB':'−∞ dB';};
 new MutationObserver(sync).observe($('pause'),{childList:true});
 new MutationObserver(sync).observe(recording,{attributes:true,attributeFilter:['class']});
 new MutationObserver(sync).observe($('live-level'),{attributes:true,attributeFilter:['value']});
 window.addEventListener('wescreen-language',sync);sync();
})();

// Compact view inspector: retain the existing rotation and tuning handlers.
(() => {
 const panel=$('playback-rotation-menu').querySelector('.playback-toolbar');
 const title=document.createElement('strong');title.className='view-inspector-title';
 const rotate=document.createElement('div');rotate.className='view-rotation-actions';
 for(const id of ['playback-left','playback-right','playback-reset'])rotate.append($(id));
 const heading=document.createElement('span');heading.className='view-section-label';
 const angle=document.querySelector('.playback-angle'),tuning=document.querySelector('.playback-tuning'),ambient=$('playback-ambient-toggle').closest('label');
 panel.classList.add('view-inspector');panel.replaceChildren(title,$('playback-fit'),heading,rotate,angle,ambient,tuning);
 const refresh=()=>{title.textContent=E('画面与方向','Frame & orientation');heading.textContent=E('旋转方向','Rotation');$('playback-left').textContent=E('↶ 左转','↶ Left');$('playback-right').textContent=E('↷ 右转','↷ Right');$('playback-reset').textContent=E('复位','Reset');};
 window.addEventListener('wescreen-language',refresh);refresh();
})();
