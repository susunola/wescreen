// Resolution is a source-dependent cap; quality selects bitrate, never invented pixels.
const captureResolutionHelp=document.createElement('p');captureResolutionHelp.id='capture-resolution-help';captureResolutionHelp.className='hint';$('record-summary').after(captureResolutionHelp);
function resolutionName(width,height){const long=Math.max(width,height),short=Math.min(width,height);return long>=7680&&short>=4320?'8K':long>=3840&&short>=2160?'4K':long>=2560&&short>=1440?'1440p':short>=1080?'1080p':short>=720?'720p':'';}
function updateCaptureQualityLabels(){
 $('framerate').querySelector('[value="0"]').textContent=E('原始帧率','Source frame rate');
 const select=$('resolution');for(const [value,zh,en] of [['native','原生像素（尽力保留）','Native pixels (best effort)'],['source','原始分辨率（随来源）','Source resolution'],['2160','4K · 3840×2160 上限','4K · up to 3840×2160'],['1440','1440p · 2560×1440 上限','1440p · up to 2560×1440'],['1080','1080p · 1920×1080 上限','1080p · up to 1920×1080'],['720','720p · 1280×720 上限','720p · up to 1280×720']]){const option=select.querySelector('[value="'+value+'"]');option.removeAttribute('data-i18n');option.textContent=E(zh,en);}
 const settings=displayStream?.getVideoTracks()[0]?.getSettings();
 const actual=settings?.width&&settings?.height;
 const prefix=['source','native'].includes(select.value)?(actual?(resolutionName(settings.width,settings.height)||settings.width+'×'+settings.height):E('原分辨率','Source resolution')):select.value==='2160'?'4K':select.value+'p';
 for(const [value,zh,en] of [['standard','标准码率','Standard bitrate'],['high','高码率','High bitrate'],['compact','省空间码率','Space-saving bitrate']]){const option=$('quality').querySelector('[value="'+value+'"]');option.removeAttribute('data-i18n');option.textContent=prefix+' · '+E(zh,en);}
 const content=$('capture-content')?.value;const textScene=content==='detail'||((!content||content==='auto')&&$('capture-mode')?.value!=='telegram');const compact=$('quality').querySelector('[value="compact"]');compact.disabled=textScene;if(textScene&&$('quality').value==='compact')$('quality').value='standard';
 for(const [value,type] of [['vp9','video/webm;codecs=vp9,opus'],['av1','video/webm;codecs=av1,opus']])$('format').querySelector('[value="'+value+'"]').disabled=!MediaRecorder.isTypeSupported(type);
 const heading=$('quality').closest('label').querySelector('span');heading.removeAttribute('data-i18n');heading.textContent=E('编码品质（码率）','Encoding quality (bitrate)');
 if(actual)captureResolutionHelp.textContent=E('实际采集：','Actual capture: ')+settings.width+'×'+settings.height+(resolutionName(settings.width,settings.height)?'（'+resolutionName(settings.width,settings.height)+'）':'')+' · '+(settings.frameRate||'?')+' fps · '+E('目标码率 ','Target bitrate ')+(videoBitrate(displayStream.getVideoTracks()[0])/1e6).toFixed(1)+' Mbps'+(recorder?.videoBitsPerSecond?' · '+E('编码器报告 ','Encoder reported ')+(recorder.videoBitsPerSecond/1e6).toFixed(1)+' Mbps':'');
 if(actual){const caps=displayStream.getVideoTracks()[0].getCapabilities?.()||{};if(caps.width?.max>settings.width*1.8&&caps.height?.max>settings.height*1.8)captureResolutionHelp.textContent+=E(' · 当前不是原生像素，请选择原生像素或重新共享。',' · Capture is below native dimensions; choose Native pixels or share again.');}
 else captureResolutionHelp.textContent=E('分辨率上限不会放大低清来源；共享后显示实际像素。原始模式可保留 4K 等源尺寸，8K 能否录制取决于设备和浏览器。','Resolution caps never upscale a smaller source. Actual pixels appear after sharing. Source mode retains source dimensions; 8K recording depends on device and browser support.');
}
for(const id of ['resolution','quality','framerate','capture-content','capture-audio-quality'])$(id).addEventListener('change',updateCaptureQualityLabels);
for(const event of ['DOMContentLoaded','wescreen-language','wescreen-capture-settings'])window.addEventListener(event,updateCaptureQualityLabels);
const qualityApplyOutput=applyOutputSize;applyOutputSize=async stream=>{const result=await qualityApplyOutput(stream);updateCaptureQualityLabels();return result;};
updateCaptureQualityLabels();
