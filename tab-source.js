// Explicitly selected alternative to getDisplayMedia. The background broker
// limits capture to the tab where the user invoked WeScreen; never guess a tab.
let tabPlayback=null,tabAudioTracks=[];
async function captureOriginalTab(){
 const response=await chrome.runtime.sendMessage({type:'original-tab-stream'});
 if(response?.error || !response?.streamId)throw new Error(response?.error || E('请先在视频标签页点击 WeScreen，再打开录制器。','Open WeScreen from the video tab first.'));
 const source={mandatory:{chromeMediaSource:'tab',chromeMediaSourceId:response.streamId}};
 const stream=await navigator.mediaDevices.getUserMedia({video:source,audio:source});tabAudioTracks=stream.getAudioTracks();
 try{
  // Tab capture mutes the original tab. Restore local listening once, separately
  // from the recording mix, so the recording neither loses audio nor doubles it.
  if(stream.getAudioTracks().length){tabPlayback=new AudioContext();tabPlayback.createMediaStreamSource(stream).connect(tabPlayback.destination);await tabPlayback.resume();}
  if(!$('screen-audio').checked)for(const track of stream.getAudioTracks()){stream.removeTrack(track);}
  return stream;
 }catch(error){stream.getTracks().forEach(track=>track.stop());closeTabPlayback();throw error;}
}
function closeTabPlayback(){tabAudioTracks.forEach(track=>track.stop());tabAudioTracks=[];if(tabPlayback){tabPlayback.close().catch(()=>{});tabPlayback=null;}}
