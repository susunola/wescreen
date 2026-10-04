// Studio layout adapts existing controls; recording, storage and media engines stay authoritative.
(() => {
  document.body.classList.add('studio-ui');
  const make = (tag, cls) => { const node=document.createElement(tag);node.className=cls;return node; };
  const form=document.querySelector('.setup-form'), columns=document.querySelector('.setup-columns');
  const stage=make('div','studio-source'), settings=make('aside','studio-record-settings');
  const picker=document.querySelector('.scenario-picker'), ready=document.querySelector('.capture-ready');
  stage.append(picker);
  document.querySelector('[data-view=capture]').addEventListener('click',()=>{if(!recorder && !displayStream && $('capture-mode').value!=='general'){$('capture-mode').value='general';applyCapturePreset();}});
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

// Recording console: preserve control IDs and media nodes while grouping their roles.
(() => {
 const recording=$('recording'),stage=document.createElement('div');stage.className='recording-preview-stage';
 const heading=document.createElement('div');heading.className='recording-console-title';const title=document.createElement('strong'),caption=document.createElement('span');heading.append(title,caption);recording.querySelector('.record-head').prepend(heading);
 const labels=()=>{title.textContent=E('录制工作台','Recording studio');caption.textContent=E('本机录制 · 原视频保留','Local capture · Originals preserved');tools.textContent=E('更多录制工具','Recording tools');};
 $('live-preview').before(stage);stage.append($('live-preview'));
 const dock=document.createElement('div');dock.className='recording-control-dock';
 const transport=document.createElement('div');transport.className='recording-transport';
 const secondary=document.createElement('details');secondary.className='recording-secondary';const tools=document.createElement('summary');tools.textContent=E('更多录制工具','Recording tools');secondary.append(tools);
 for(const id of ['pause','mark','stop'])transport.append($(id));
 for(const id of ['next-channel-video','copy-next-message','floating-controls','capture-monitor-live'])if($(id))secondary.append($(id));
 const old=recording.querySelector(':scope > .controls');old?.remove();
 dock.append(transport,recording.querySelector('.source-status'),secondary);stage.after(dock);
 const diagnostics=document.createElement('details');diagnostics.className='recording-diagnostics';
 const summary=document.createElement('summary');summary.textContent=E('录制诊断','Recording diagnostics');diagnostics.append(summary);
 for(const id of ['recording-health','capture-quality-stats'])if($(id))diagnostics.append($(id));
 recording.append(diagnostics);labels();window.addEventListener('wescreen-language',labels);window.addEventListener('wescreen-language',()=>summary.textContent=E('录制诊断','Recording diagnostics'));
})();
