// Playback-only rotation. Export rotation remains in the editor.
let playbackRotation=0;
function layoutPlaybackRotation() {
 const video=$('preview'),stage=$('playback-stage');
 if(!video.videoWidth || !video.videoHeight || !stage.clientWidth)return;
 const radians=playbackRotation*Math.PI/180,c=Math.abs(Math.cos(radians)),s=Math.abs(Math.sin(radians));
 const boundsWidth=video.videoWidth*c+video.videoHeight*s,boundsHeight=video.videoWidth*s+video.videoHeight*c;
 const maxHeight=document.fullscreenElement===$('playback-shell') ? Math.max(120,innerHeight-160):540;
 const scale=Math.min(stage.clientWidth/boundsWidth,maxHeight/boundsHeight);
 stage.style.height=`${boundsHeight*scale}px`;video.style.width=`${video.videoWidth*scale}px`;video.style.height=`${video.videoHeight*scale}px`;
 video.style.transform=`translate(-50%, -50%) rotate(${playbackRotation}deg)`;
 video.controls=playbackRotation===0;$('rotated-playback-controls').hidden=playbackRotation===0;
}
function setPlaybackRotation(degrees) {
 if(!Number.isFinite(degrees))return;
 playbackRotation=((degrees%360)+360)%360;$('playback-angle').value=String(playbackRotation);layoutPlaybackRotation();
}
function resetPlaybackRotation(){setPlaybackRotation(0);}
$('playback-left').onclick=()=>setPlaybackRotation(playbackRotation-90);
$('playback-right').onclick=()=>setPlaybackRotation(playbackRotation+90);
$('playback-reset').onclick=resetPlaybackRotation;
$('playback-angle').oninput=()=>setPlaybackRotation(Number($('playback-angle').value));
$('preview').addEventListener('loadedmetadata',layoutPlaybackRotation);
new ResizeObserver(layoutPlaybackRotation).observe($('playback-stage'));
document.addEventListener('fullscreenchange',layoutPlaybackRotation);
$('playback-fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await $('playback-shell').requestFullscreen();}catch(error){setNotice(error.message);}};
$('rotated-play').onclick=()=>{const video=$('preview');if(video.paused)video.play().catch(error=>setNotice(error.message));else video.pause();};
$('rotated-mute').onclick=()=>{$('preview').muted=!$('preview').muted;};
$('preview').addEventListener('timeupdate',()=>{const video=$('preview');if(Number.isFinite(video.duration) && video.duration>0)$('rotated-seek').value=String(video.currentTime/video.duration);});
$('rotated-seek').oninput=()=>{const video=$('preview');if(Number.isFinite(video.duration))video.currentTime=Number($('rotated-seek').value)*video.duration;};
