// CivilSpace engine core — ported VERBATIM from rosetta_mapper_v10.html
// (lines 526-686). The matching math is frozen; this is the parity ORACLE the
// TypeScript rewrite must reproduce exactly. No DOM, no canvas — pure compute.
//
// Inputs come from a data Contract (GFC_COLS, ETABS_COLS, ETABS_WALLS). The only
// thing not in the contract is the 3-point calibration seed (the engineer clicks
// it in the app). For a DETERMINISTIC oracle we derive a fixed seed from the
// point clouds (see deriveSeed); the SAME seed is fed to both engines, so parity
// is about the engine math, not the seed source.

const PIER_TOL = 250;   // mm (v10 absolute value; handoff flags for corpus sweep)

// ---- linear algebra (verbatim) ----
function solveAffine(srcPts, dstPts) {
  const p0=srcPts[0],p1=srcPts[1],p2=srcPts[2], q0=dstPts[0],q1=dstPts[1],q2=dstPts[2];
  const M=[[p0.x,p0.y,1,0,0,0],[0,0,0,p0.x,p0.y,1],[p1.x,p1.y,1,0,0,0],[0,0,0,p1.x,p1.y,1],[p2.x,p2.y,1,0,0,0],[0,0,0,p2.x,p2.y,1]];
  const b=[q0.x,q0.y,q1.x,q1.y,q2.x,q2.y]; const n=6;
  for(let i=0;i<n;i++){ let mr=i; for(let k=i+1;k<n;k++) if(Math.abs(M[k][i])>Math.abs(M[mr][i])) mr=k;
    const tM=M[i];M[i]=M[mr];M[mr]=tM; const tb=b[i];b[i]=b[mr];b[mr]=tb;
    for(let k=i+1;k<n;k++){ const f=M[k][i]/M[i][i]; for(let j=i;j<n;j++) M[k][j]-=f*M[i][j]; b[k]-=f*b[i]; } }
  const x=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){ x[i]=b[i]; for(let j=i+1;j<n;j++) x[i]-=M[i][j]*x[j]; x[i]/=M[i][i]; }
  return {a:x[0],b:x[1],c:x[2],d:x[3],e:x[4],f:x[5]};
}
function applyAffineTransform(aff,px,py){ return [aff.a*px+aff.b*py+aff.c, aff.d*px+aff.e*py+aff.f]; }

function genericSolve(A,b){
  const n=b.length, M=A.map(r=>r.slice()), x=b.slice();
  for(let i=0;i<n;i++){ let mr=i; for(let k=i+1;k<n;k++) if(Math.abs(M[k][i])>Math.abs(M[mr][i])) mr=k;
    [M[i],M[mr]]=[M[mr],M[i]]; [x[i],x[mr]]=[x[mr],x[i]];
    for(let k=i+1;k<n;k++){ const fct=M[k][i]/M[i][i]; for(let jj=i;jj<n;jj++) M[k][jj]-=fct*M[i][jj]; x[k]-=fct*x[i]; } }
  const r=new Array(n).fill(0);
  for(let i=n-1;i>=0;i--){ r[i]=x[i]; for(let jj=i+1;jj<n;jj++) r[i]-=M[i][jj]*r[jj]; r[i]/=M[i][i]; }
  return r;
}
function fitSimilarity(src,dst){
  function solveForm(sign){
    const N=[[0,0,0,0],[0,0,0,0],[0,0,0,0],[0,0,0,0]], rhs=[0,0,0,0];
    function acc(row,val){ for(let i=0;i<4;i++){ rhs[i]+=row[i]*val; for(let j=0;j<4;j++) N[i][j]+=row[i]*row[j]; } }
    for(let k=0;k<src.length;k++){ const x=src[k][0],y=src[k][1],X=dst[k][0],Y=dst[k][1];
      if(sign>0){ acc([x,-y,1,0],X); acc([y,x,0,1],Y); } else { acc([x,y,1,0],X); acc([-y,x,0,1],Y); } }
    const u=genericSolve(N,rhs); let sse=0;
    for(let k=0;k<src.length;k++){ const x=src[k][0],y=src[k][1];
      const X=sign>0?u[0]*x-u[1]*y+u[2]:u[0]*x+u[1]*y+u[2];
      const Y=sign>0?u[1]*x+u[0]*y+u[3]:u[1]*x-u[0]*y+u[3];
      sse+=(X-dst[k][0])**2+(Y-dst[k][1])**2; }
    const M=sign>0?{a:u[0],b:-u[1],c:u[2],d:u[1],e:u[0],f:u[3]}:{a:u[0],b:u[1],c:u[2],d:u[1],e:-u[0],f:u[3]};
    return {M,sse};
  }
  const P=solveForm(1),Q=solveForm(-1);
  return (P.sse<=Q.sse)?P.M:Q.M;
}
function linAnisotropy(M){
  const a=M.a,b=M.b,c=M.d,d=M.e, A=a*a+b*b, B=c*c+d*d, Cc=a*c+b*d;
  const t=(A+B)/2, r=Math.sqrt(Math.max(0,((A-B)/2)**2+Cc*Cc));
  const s1=Math.sqrt(Math.max(0,t+r)), s2=Math.sqrt(Math.max(0,t-r));
  return s2>1e-9?s1/s2:999;
}
function distSeg(px,py,x1,y1,x2,y2){
  const vx=x2-x1,vy=y2-y1, L=vx*vx+vy*vy;
  if(L===0) return Math.hypot(px-x1,py-y1);
  let t=((px-x1)*vx+(py-y1)*vy)/L; t=Math.max(0,Math.min(1,t));
  return Math.hypot(px-(x1+t*vx),py-(y1+t*vy));
}

function icpRefine(seed, GFC_COLS, ETABS_COLS){
  let M=Object.assign({},seed);
  for(const gate of [3000,2000,1200,800,600,500,450,400,400,400]){
    const src=[],dst=[];
    for(const col of GFC_COLS){ const t=applyAffineTransform(M,col.cx,col.cy);
      let bj=-1,bd=gate; for(let j=0;j<ETABS_COLS.length;j++){ const e=ETABS_COLS[j]; const dd=Math.hypot(t[0]-e.x,t[1]-e.y); if(dd<bd){bd=dd;bj=j;} }
      if(bj>=0){ src.push([col.cx,col.cy]); dst.push([ETABS_COLS[bj].x,ETABS_COLS[bj].y]); } }
    if(src.length<6) break;
    M=fitSimilarity(src,dst);
  }
  return M;
}

function hungarian(costMatrix){
  const n=costMatrix.length,m=costMatrix[0].length,INF=1e18,sz=Math.max(n,m);
  const C=[]; for(let i=0;i<sz;i++){ const row=[]; for(let j=0;j<sz;j++) row.push(i<n&&j<m?costMatrix[i][j]:INF*0.1); C.push(row); }
  const u=new Array(sz+1).fill(0),v=new Array(sz+1).fill(0),p=new Array(sz+1).fill(0),way=new Array(sz+1).fill(0);
  for(let i=1;i<=sz;i++){ p[0]=i; let j0=0; const minVal=new Array(sz+1).fill(INF),used=new Array(sz+1).fill(false);
    do{ used[j0]=true; let i0=p[j0],delta=INF,j1=-1;
      for(let j=1;j<=sz;j++){ if(!used[j]){ const cur=C[i0-1][j-1]-u[i0]-v[j];
        if(cur<minVal[j]){minVal[j]=cur;way[j]=j0;} if(minVal[j]<delta){delta=minVal[j];j1=j;} } }
      for(let j=0;j<=sz;j++){ if(used[j]){u[p[j]]+=delta;v[j]-=delta;} else minVal[j]-=delta; } j0=j1;
    } while(p[j0]!==0);
    do{ const j1=way[j0]; p[j0]=p[j1]; j0=j1; } while(j0); }
  const res=new Array(n); for(let j=1;j<=sz;j++) if(p[j]&&p[j]<=n) res[p[j]-1]=j-1; return res;
}

// Full column match — verbatim port of runHungarian (lines 613-668), minus DOM.
function runColumnMatch(seedTransform, ctx, maxCap){
  const {GFC_COLS, ETABS_COLS, ETABS_WALLS} = ctx;
  const refined=icpRefine(seedTransform, GFC_COLS, ETABS_COLS);
  const gfcT=GFC_COLS.map(col=>{ const t=applyAffineTransform(refined,col.cx,col.cy); return {id:col.id,tx:t[0],ty:t[1],rw:col.rw,rh:col.rh}; });
  const nG=gfcT.length,nE=ETABS_COLS.length;
  const D=[]; for(let i=0;i<nG;i++){ const row=new Array(nE),g=gfcT[i]; for(let j=0;j<nE;j++){ const e=ETABS_COLS[j]; row[j]=Math.hypot(g.tx-e.x,g.ty-e.y); } D.push(row); }
  const nn2=new Array(nG); for(let i=0;i<nG;i++){ let m1=Infinity,m2=Infinity; for(let j=0;j<nE;j++){ const d=D[i][j]; if(d<m1){m2=m1;m1=d;} else if(d<m2)m2=d; } nn2[i]=m2; }
  const nnE=new Array(nE).fill(Infinity); for(let j=0;j<nE;j++){ for(let k=0;k<nE;k++){ if(k===j)continue; const d=Math.hypot(ETABS_COLS[j].x-ETABS_COLS[k].x,ETABS_COLS[j].y-ETABS_COLS[k].y); if(d<nnE[j])nnE[j]=d; } }
  const cost=D.map(row=>row.map(d=>Math.min(d,1e8)));
  const asg=hungarian(cost);
  let matchResult=[]; const used=new Set();
  for(let i=0;i<nG;i++){ const j=asg[i],g=gfcT[i],e=(j!=null&&j<nE)?ETABS_COLS[j]:null;
    let conf='LOW';
    if(e){ const d=D[i][j],ratio=d/Math.max(nn2[i],1e-9),sp=nnE[j];
      if(d<0.18*sp&&ratio<0.5&&d<maxCap) conf='HIGH';
      else if(d<0.45*sp&&ratio<0.75&&d<maxCap) conf='MED'; }
    const accepted=e&&conf!=='LOW'; if(accepted) used.add(j);
    const dd=e?D[i][j]:Infinity;
    matchResult.push({ gfc_id:g.id, etabs_id:accepted?e.id:null, gfc_tx:Math.round(g.tx),gfc_ty:Math.round(g.ty),
      etabs_x:accepted?e.x:null, etabs_y:accepted?e.y:null, dist:e?Math.round(dd):null, matched:accepted, confidence:conf,
      ratio:e?+(dd/Math.max(nn2[i],1e-9)).toFixed(2):null }); }
  for(let j=0;j<nE;j++){ if(!used.has(j)){ const e=ETABS_COLS[j];
    matchResult.push({ gfc_id:null, etabs_id:e.id, gfc_tx:null,gfc_ty:null, etabs_x:e.x,etabs_y:e.y, dist:null, matched:false, confidence:'UNMATCHED_ETABS' }); } }
  // pier cross-check
  matchResult.forEach(m=>{ if(m.gfc_id && m.confidence==='LOW'){
    const g=GFC_COLS.find(c=>c.id===m.gfc_id); const t=applyAffineTransform(refined,g.cx,g.cy);
    let best=1e9,bp=null; for(const w of ETABS_WALLS){ const d=distSeg(t[0],t[1],w.x1,w.y1,w.x2,w.y2); if(d<best){best=d;bp=w.sw;} }
    if(best<PIER_TOL){ m.confidence='WALL'; m.pier=bp; m.wall_dist=Math.round(best); m.matched=false; }
  }});
  // mutual-nearest recovery
  const _ei={}; ETABS_COLS.forEach((c,j)=>_ei[c.id]=j);
  matchResult.filter(m=>m.confidence==='UNMATCHED_ETABS').forEach(me=>{
    const ej=_ei[me.etabs_id];
    let gi=-1,gd=Infinity; for(let i=0;i<gfcT.length;i++){ if(D[i][ej]<gd){gd=D[i][ej];gi=i;} }
    if(gi<0) return;
    let eb=-1,bd=Infinity; for(let j=0;j<ETABS_COLS.length;j++){ if(D[gi][j]<bd){bd=D[gi][j];eb=j;} }
    if(eb!==ej) return;
    const gentry=matchResult.find(m=>m.gfc_id===gfcT[gi].id);
    if(!gentry || gentry.confidence!=='LOW') return;
    if(gd > 0.6*nnE[ej]) return;
    const e=ETABS_COLS[ej];
    gentry.etabs_id=e.id; gentry.matched=true; gentry.confidence='MED'; gentry.mutual=true;
    gentry.dist=Math.round(gd); gentry.posdev=(gd>0.4*nnE[ej]); gentry.ratio=null;
    me._rm=true;
  });
  matchResult=matchResult.filter(m=>!m._rm);
  const tally=(c)=>matchResult.filter(m=>m.confidence===c).length;
  return {
    refined, anisotropy:+linAnisotropy(refined).toFixed(4),
    counts:{ HIGH:tally('HIGH'), MED:tally('MED'), LOW:tally('LOW'),
             WALL:tally('WALL'), UNMATCHED_ETABS:tally('UNMATCHED_ETABS') },
    matchResult
  };
}

module.exports = { solveAffine, applyAffineTransform, fitSimilarity, icpRefine,
  hungarian, linAnisotropy, distSeg, runColumnMatch, PIER_TOL };
