// Explicitly selected alternative to getDisplayMedia. The background broker
// limits capture to the tab where the user invoked WeScreen; never guess a tab.
let tabPlayback=null,tabAudioTracks=[],quietTabCapture=false;
async function captureOriginalTab(){
 quietTabCapture=$('quiet-tab-audio').checked;
 const response=await chrome.runtime.sendMessage({type:'original-tab-stream'});
 if(response?.error || !response?.streamId)throw new Error(response?.error || E('请先在视频标签页点击 WeScreen，再打开录制器。','Open WeScreen from the video tab first.'));
 const source={mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:response.streamId}};
 const stream=await navigator.mediaDevices.getUserMedia({video:source,audio:source});tabAudioTracks=stream.getAudioTracks();
 try{
  if(quietTabCapture){const result=await chrome.runtime.sendMessage({type:'quiet-tab-audio',active:true});if(result?.error)throw new Error(result.error);}
  // Tab capture suppresses original playback. The monitor is separate from
  // the recording mix; zero gain keeps listening silent without muting the recording.
  if(stream.getAudioTracks().length){tabPlayback=new AudioContext();const monitor=tabPlayback.createGain();monitor.gain.value=quietTabCapture ? 0:1;tabPlayback.createMediaStreamSource(stream).connect(monitor).connect(tabPlayback.destination);await tabPlayback.resume();}
  if(!$('screen-audio').checked)for(const track of stream.getAudioTracks()){stream.removeTrack(track);}
  return stream;
 }catch(error){stream.getTracks().forEach(track=>track.stop());closeTabPlayback();throw error;}
}
function closeTabPlayback(){if(quietTabCapture){chrome.runtime.sendMessage({type:"quiet-tab-audio",active:false}).catch(()=>{});quietTabCapture=false;}tabAudioTracks.forEach(track=>track.stop());tabAudioTracks=[];if(tabPlayback){tabPlayback.close().catch(()=>{});tabPlayback=null;}}
