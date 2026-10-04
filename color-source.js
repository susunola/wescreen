// Inspect bounded MP4 metadata only; never decode or upload a video to identify HDR.
let playerColor={mode:'unknown'},playerColorReady=Promise.resolve(playerColor),nativeSmartHDR=false;
async function inspectVideoColor(blob){
 const unknown={mode:'unknown'};let offset=0;
 const text=(v,p)=>String.fromCharCode(...new Uint8Array(v.buffer,v.byteOffset+p,4));
 function boxes(view,start,end,depth=0){
  if(depth>12)return null;
  for(let p=start;p+8<=end;){let size=view.getUint32(p),header=8;const type=text(view,p+4);
   if(size===1){if(p+16>end)return null;size=Number(view.getBigUint64(p+8));header=16;}if(size===0)size=end-p;
   if(size<header||p+size>end)return null;
   let child=null;
   if(type==='colr'&&size>=header+10&&['nclx','nclc'].includes(text(view,p+header))){const transfer=view.getUint16(p+header+6);return {mode:[16,18].includes(transfer)?'hdr':transfer===1||transfer===6||transfer===13?'sdr':'unknown',transfer};}
   if(['moov','trak','mdia','minf','stbl'].includes(type))child=boxes(view,p+header,p+size,depth+1);
   if(type==='stsd')child=boxes(view,p+header+8,p+size,depth+1);
   if(['avc1','avc3','hvc1','hev1','vp09','av01'].includes(type))child=boxes(view,p+header+78,p+size,depth+1);
   if(child)return child;p+=size;
  }return null;
 }
 try{for(let count=0;offset+8<=blob.size&&count<1024;count++){
  const header=new DataView(await blob.slice(offset,offset+16).arrayBuffer());let size=header.getUint32(0);const type=text(header,4);
  if(size===1){if(header.byteLength<16)return unknown;size=Number(header.getBigUint64(8));}if(size===0)size=blob.size-offset;
  if(!Number.isSafeInteger(size)||size<8||offset+size>blob.size)return unknown;
  if(type==='moov'){if(size>8*1024*1024)return unknown;return boxes(new DataView(await blob.slice(offset,offset+size).arrayBuffer()),0,size)||unknown;}offset+=size;
 }}catch{}return unknown;
}
function detectPlaybackColor(blob){
 const generation=playbackGeneration;nativeSmartHDR=false;playerColor={mode:'unknown'};
 playerColorReady=inspectVideoColor(blob).then(color=>{if(generation!==playbackGeneration)return {mode:'unknown'};playerColor=color;if(color.mode==='hdr'){stopRealtimeAI();instantEnhancement=null;$('preview').style.filter='none';}return color;});
}
