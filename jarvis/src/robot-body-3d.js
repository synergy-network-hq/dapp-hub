// Real articulated meshes, depth-sorted and lit in the same canvas style as the head.
const rad = n => n * Math.PI / 180;
const rotate = (p, a, axis = 'z') => {
  const c = Math.cos(a), s = Math.sin(a), [x,y,z] = p;
  return axis === 'y' ? [x*c+z*s,y,z*c-x*s] : axis === 'x' ? [x,y*c-z*s,y*s+z*c] : [x*c-y*s,x*s+y*c,z];
};
const add = (a,b) => a.map((v,i)=>v+b[i]);
const color = hex => hex.replace('#','').match(/../g).map(n=>parseInt(n,16));

// Subdivided rounded cuboid, with actual front, back, sides and curved bevels.
export function roundedMesh(width,height,depth,radius=2) {
  const half=[width/2,height/2,depth/2], inner=half.map(n=>Math.max(0,n-radius)), faces=[];
  for(let axis=0;axis<3;axis++) for(const sign of [-1,1]) {
    const u=(axis+1)%3,v=(axis+2)%3,steps=4;
    const point=(a,b)=>{
      const p=[0,0,0];p[axis]=sign*half[axis];p[u]=a*half[u];p[v]=b*half[v];
      const base=p.map((n,i)=>Math.max(-inner[i],Math.min(inner[i],n)));
      const delta=p.map((n,i)=>n-base[i]),length=Math.hypot(...delta)||1;
      return {p:base.map((n,i)=>n+delta[i]/length*radius),n:delta.map(n=>n/length)};
    };
    for(let i=0;i<steps;i++)for(let j=0;j<steps;j++){
      const vertices=[[i,j],[i+1,j],[i+1,j+1],[i,j+1]].map(([a,b])=>point(a/steps*2-1,b/steps*2-1));
      faces.push(vertices);
    }
  }
  return faces;
}
const cache=new Map();
function mesh(w,h,d,r){const key=[w,h,d,r].join(':');if(!cache.has(key))cache.set(key,roundedMesh(w,h,d,r));return cache.get(key);}

export function drawRobotBody(ctx,pose,state,theme,time,logo) {
  const faces=[],yaw=.18+Math.sin(time*.6)*.035, pitch=-.07;
  const camera = p => rotate(rotate(p,yaw,'y'),pitch,'x');
  const project = p => {const perspective=500/(500-p[2]);return [64+p[0]*perspective,115+p[1]*perspective];};
  const transform=(p,chain)=>chain.reduce((v,j)=>add(rotate(v,rad(j.angle||0)),j.position),p);
  function part(size,position,tint,chain=[],radius=2) {
    for(const quad of mesh(...size,radius)){
      const points=quad.map(v=>camera(transform(add(v.p,position),chain)));
      const normal=quad.reduce((sum,v)=>add(sum,v.n),[0,0,0]);
      const n=camera(chain.reduce((v,j)=>rotate(v,rad(j.angle||0)),normal));
      const len=Math.hypot(...n)||1;const norm=n.map(v=>v/len);
      if(norm[2]<-.1)continue;
      const diffuse=Math.max(0,(-norm[0]*.45-norm[1]*.65+norm[2]*.7));
      const spec=Math.pow(Math.max(0,-norm[0]*.25-norm[1]*.35+norm[2]*.9),24);
      const rgb=color(tint).map(v=>Math.min(255,Math.round(v*(.3+diffuse*.8)+spec*100)));
      faces.push({points,z:points.reduce((sum,p)=>sum+p[2],0)/4,fill:`rgb(${rgb.join(',')})`});
    }
  }
  const upper=[{angle:pose.lean,position:[0,pose.crouch,0]}];
  const shell=theme.color,metal='#a4bacf',dark='#111e2f';
  part([14,16,12],[0,-42,0],metal,upper,3);
  for(const y of [-45,-41,-37])part([14,1.5,12],[0,y,0],dark,upper,.5);
  part([38,35,23],[0,-17,0],shell,upper,6);
  part([25,25,3],[0,-18,12],metal,upper,3);
  part([22,22,3],[0,-18,14], '#070e19',upper,2);
  for(const y of [-1,2])part([14,1.5,2],[0,y,11],dark,upper,.5);
  part([27,8,19],[0,7,0],metal,upper,3);
  for(const side of ['left','right']){
    const sign=side==='left'?-1:1;
    const shoulder=[{angle:pose[side+'Arm'],position:[sign*24,-27,12]},...upper];
    part([13,13,15],[0,0,0],metal,shoulder,6);
    part([10,17,12],[0,10,0],shell,shoulder,4);
    const elbow=[{angle:pose[side+'Elbow'],position:[0,18,7]},...shoulder];
    part([10,10,12],[0,0,0],metal,elbow,4);
    part([10,14,12],[0,10,0],shell,elbow,4);
    part([11,3,13],[0,15,0],theme.trimColor,elbow,1);
    const hand=[{angle:0,position:[0,23,2]},...elbow];
    part([11,10,7],[0,0,0],metal,hand,3);
    for(let finger=0;finger<3;finger++){
      const extended=state==='happy'&&side==='left'||state==='thinking'&&side==='right'&&finger===2;
      part([2.6,extended?9:4,3],[finger*3-3,extended?8:5,0],metal,hand,1.2);
    }
    const thumbSide=state==='happy'&&side==='left'?-1:-sign;
    part([3,7,4],[thumbSide*6,0,1],metal,hand,1.4);
    const hip=[{angle:pose[side+'Leg'],position:[sign*10,6+pose.crouch,0]}];
    part([12,12,14],[0,0,0],dark,hip,5);
    part([11,16,13],[0,9,0],shell,hip,4);
    const knee=[{angle:pose[side+'Knee'],position:[0,16,state==='sleeping'?(side==='left'?5:1):1]},...hip];
    part([11,10,13],[0,0,0],metal,knee,4);
    part([10,13,12],[0,8,0],shell,knee,3);
    part([17,9,23],[0,17,5],metal,knee,3);
    part([16,2,22],[0,21,5],theme.trimColor,knee,.8);
  }
  // Chest logo is a texture on the front plane, participating in depth sorting.
  const logoPoints=[[-7,-25,16],[7,-25,16],[7,-11,16],[-7,-11,16]].map(p=>camera(transform(p,upper)));
  faces.push({points:logoPoints,z:logoPoints.reduce((n,p)=>n+p[2],0)/4,logo:true});
  faces.sort((a,b)=>a.z-b.z);
  ctx.clearRect(0,0,128,168);
  for(const face of faces){
    const p=face.points.map(project);
    if(face.logo){
      if(!logo?.complete||!logo.naturalWidth)continue;
      ctx.save();ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.clip();
      ctx.transform((p[1][0]-p[0][0])/logo.naturalWidth,(p[1][1]-p[0][1])/logo.naturalWidth,(p[3][0]-p[0][0])/logo.naturalHeight,(p[3][1]-p[0][1])/logo.naturalHeight,p[0][0],p[0][1]);ctx.drawImage(logo,0,0);ctx.restore();continue;
    }
    ctx.beginPath();p.forEach(([x,y],i)=>i?ctx.lineTo(x,y):ctx.moveTo(x,y));ctx.closePath();ctx.fillStyle=face.fill;ctx.fill();ctx.strokeStyle=face.fill;ctx.lineWidth=.35;ctx.stroke();
  }
}
