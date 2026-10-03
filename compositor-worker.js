// Compose from incoming frames in a worker. Either source can drive the output,
// so camera motion is preserved even when the shared screen is completely static.
self.onmessage = async ({ data }) => {
  const screenReader=data.screen.getReader(),cameraReader=data.camera.getReader(),writer=data.output.getWriter();
  let screen=null,camera=null,screenReceivedAt=0,canvas,ctx,busy=false,dirty=false,running=true,ready=false,lastTimestamp=-1,lastDrawAt=-Infinity;
  const interval=1000/(data.frameRate || 30);
  const fail=error=>{if(running)self.postMessage({type:'error',message:error.message || String(error)});};
  async function draw(){
    dirty=true;
    if(!running || busy || !screen || !camera || performance.now()-lastDrawAt<interval*.9)return;
    busy=true;dirty=false;let output;
    try {
      if(!canvas || canvas.width!==screen.displayWidth || canvas.height!==screen.displayHeight){canvas=new OffscreenCanvas(screen.displayWidth,screen.displayHeight);ctx=canvas.getContext('2d',{alpha:false});}
      ctx.drawImage(screen,0,0,canvas.width,canvas.height);
      const w=Math.round(canvas.width*.23),h=Math.round(w*camera.displayHeight/camera.displayWidth),pad=Math.round(canvas.width*.025);
      ctx.save();ctx.beginPath();ctx.roundRect(canvas.width-w-pad,canvas.height-h-pad,w,h,w*.08);ctx.clip();ctx.drawImage(camera,canvas.width-w-pad,canvas.height-h-pad,w,h);ctx.restore();
      const timestamp=Math.max(lastTimestamp+1,screen.timestamp+Math.round((performance.now()-screenReceivedAt)*1000));lastTimestamp=timestamp;lastDrawAt=performance.now();
      output=new VideoFrame(canvas,{timestamp});await writer.write(output);
      if(!ready){ready=true;self.postMessage({type:'ready'});}
    }catch(error){fail(error);}finally{output?.close();busy=false;if(dirty && running)queueMicrotask(draw);}
  }
  async function read(reader,kind){
    while(running){const {value,done}=await reader.read();if(done){if(running)throw new Error(kind+' video source ended');return;}
      if(kind==='screen'){screen?.close();screen=value;screenReceivedAt=performance.now();}else{camera?.close();camera=value;}
      draw().catch(fail);
    }
  }
  try{await Promise.all([read(screenReader,'screen'),read(cameraReader,'camera')]);}catch(error){fail(error);}
  finally{running=false;screen?.close();camera?.close();await Promise.allSettled([screenReader.cancel(),cameraReader.cancel(),writer.close()]);}
};
