/** A presence indicator made only of dots. This is not the work-data graph. */
export function createOrb(canvas) {
  const context=canvas.getContext('2d');
  const reduced=matchMedia('(prefers-reduced-motion: reduce)');
  const thumbnail=new URLSearchParams(location.search).has('thumbnail');
  const points=Array.from({length:460},(_,i)=>{
    const y=1-2*(i+.5)/460, radius=Math.sqrt(1-y*y), angle=i*Math.PI*(3-Math.sqrt(5));
    return {x:Math.cos(angle)*radius,y,z:Math.sin(angle)*radius,phase:i*.37};
  });
  let state='ready',frame=0,time=0,last=0,size=215;
  function draw(now) {
    const dt=last?Math.min(40,now-last):0;last=now;
    const quiet=reduced.matches||thumbnail;
    const intensity=state==='listening'?1:state==='speaking'?1.4:state==='thinking'?.8:.2;
    if(!quiet)time+=dt*(state==='thinking'?.0011:.00025);
    context.clearRect(0,0,size,size);
    const rotation=quiet?.4:time, tilt=.18;
    const pulse=quiet?1:1+Math.sin(time*(state==='ready'?3:11))*(.025+intensity*.02);
    const transformed=points.map(point=>{
      const wobble=quiet?0:Math.sin(time*12+point.phase)*.022*intensity;
      const x=point.x*Math.cos(rotation)+point.z*Math.sin(rotation);
      const z=-point.x*Math.sin(rotation)+point.z*Math.cos(rotation);
      return {x:x*(pulse+wobble),y:(point.y*Math.cos(tilt)-z*Math.sin(tilt))*(pulse+wobble),z:point.y*Math.sin(tilt)+z*Math.cos(tilt)};
    }).sort((a,b)=>a.z-b.z);
    transformed.forEach(p=>{
      const depth=(p.z+1)/2, perspective=1/(1-p.z*.11), radius=size*.345;
      context.beginPath();
      context.arc(size/2+p.x*radius*perspective,size/2+p.y*radius*perspective,Math.max(.4,size/215*(.55+depth*.85)),0,Math.PI*2);
      context.fillStyle='rgba(45,45,45,'+(.1+depth*.7)+')';context.fill();
    });
    frame=(!quiet&&!document.hidden)?requestAnimationFrame(draw):0;
  }
  function refresh(){
    cancelAnimationFrame(frame);frame=0;last=0;
    const width=canvas.getBoundingClientRect().width;
    if(!width)return;
    size=width;const ratio=Math.min(devicePixelRatio||1,2);
    canvas.width=Math.round(size*ratio);canvas.height=Math.round(size*ratio);
    context.setTransform(ratio,0,0,ratio,0,0);draw(performance.now());
  }
  const observer=new ResizeObserver(refresh);observer.observe(canvas);
  reduced.addEventListener('change',refresh);
  document.addEventListener('visibilitychange',refresh);
  return {setState(value){state=value;if(!frame)refresh();}};
}
