// A verified page-video region follows source frames even when the recorder is hidden.
let region=null,outputSize=null;
self.onmessage=async({data})=>{
 if(data.type==='region'){region=data.region;return;}
 const reader=data.screen.getReader(),writer=data.output.getWriter();region=data.region;
 let canvas,ctx,frame,ready=false;
 try{
  for(;;){const {value,done}=await reader.read();if(done)break;frame=value;
   try{
    if(!canvas){const w=Math.max(2,Math.floor(frame.displayWidth*region.width/2)*2),h=Math.max(2,Math.floor(frame.displayHeight*region.height/2)*2);canvas=new OffscreenCanvas(w,h);ctx=canvas.getContext('2d',{alpha:false});outputSize={width:w,height:h};}
    ctx.fillStyle='#000';ctx.fillRect(0,0,canvas.width,canvas.height);
    if(region){const x=frame.displayWidth*region.x,y=frame.displayHeight*region.y,w=frame.displayWidth*region.width,h=frame.displayHeight*region.height;
     const scale=Math.min(canvas.width/w,canvas.height/h),dw=w*scale,dh=h*scale;ctx.imageSmoothingEnabled=false;ctx.drawImage(frame,x,y,w,h,(canvas.width-dw)/2,(canvas.height-dh)/2,dw,dh);}
    const output=new VideoFrame(canvas,{timestamp:frame.timestamp});try{await writer.write(output);}finally{output.close();}
    if(!ready){ready=true;self.postMessage({type:'ready',...outputSize});}
   }finally{frame.close();frame=null;}
  }
 }catch(error){self.postMessage({type:'error',message:error.message});}
 finally{frame?.close();await Promise.allSettled([reader.cancel(),writer.close()]);}
};
