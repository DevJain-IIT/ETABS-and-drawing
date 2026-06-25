// Capture the GOLDEN ORACLE output: run the verbatim v10 engine on the Gwalior
// contract and dump the computed column-match result to golden_oracle.json.
//
// The TS rewrite must reproduce this byte-for-byte (parity gate). Because the
// 3-point calibration seed is normally clicked by the engineer, we derive a
// DETERMINISTIC seed here (centroid + PCA-axis reflection-aware bootstrap, then
// the engine's own ICP converges it). The SAME seed routine is used by the TS
// engine, so the gate tests the matching math, not the seed source.

const fs = require('fs');
const path = require('path');
const E = require('./engine_core.js');

const contractPath = process.argv[2] ||
  path.join(__dirname, '..', '..', 'backend', 'fixtures', 'sample_gwalior_contract.json');
const C = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const GFC_COLS = C.gfc_cols, ETABS_COLS = C.etabs_cols, ETABS_WALLS = C.etabs_walls || [];

// ---- deterministic seed: reflection-aware bbox alignment, brute-forced ----
// Try {2 reflections} x {0/90/180/270 deg}; build a 3-point similarity seed from
// each cloud's bbox centroid + width, refine each with the engine's own ICP, and
// keep the hypothesis with the lowest mean residual. This reliably finds the
// y-flip the handoff documents (refl=-1) without any human-clicked seed.
function deriveSeed(){
  const G=GFC_COLS, Ec=ETABS_COLS;
  const bbox=(pts,fx,fy)=>{const xs=pts.map(fx),ys=pts.map(fy);return [Math.min(...xs),Math.max(...xs),Math.min(...ys),Math.max(...ys)];};
  const gb=bbox(G,c=>c.cx,c=>c.cy), eb=bbox(Ec,c=>c.x,c=>c.y);
  const gcx=(gb[0]+gb[1])/2,gcy=(gb[2]+gb[3])/2, ecx=(eb[0]+eb[1])/2,ecy=(eb[2]+eb[3])/2;
  const gw=gb[1]-gb[0], scale=(eb[1]-eb[0])/gw;
  const meanResidual=(M)=>{ let s=0; for(const c of G){ const t=E.applyAffineTransform(M,c.cx,c.cy);
    let bd=Infinity; for(const e of Ec){ const d=Math.hypot(t[0]-e.x,t[1]-e.y); if(d<bd)bd=d; } s+=bd; } return s/G.length; };
  let best=null,bestR=Infinity,bestDesc='';
  for(const refl of [1,-1]){
    for(const deg of [0,90,180,270]){
      const r=deg*Math.PI/180, ca=Math.cos(r),sa=Math.sin(r);
      const src=[{x:gcx,y:gcy},{x:gcx+gw,y:gcy},{x:gcx,y:gcy+gw}];
      const dst=src.map(p=>{ const dx=(p.x-gcx)*scale, dy=(p.y-gcy)*scale*refl;
        return {x:ecx+dx*ca-dy*sa, y:ecy+dx*sa+dy*ca}; });
      const seed=E.solveAffine(src,dst);
      const refined=E.icpRefine(seed, G, Ec);
      const rr=meanResidual(refined);
      if(rr<bestR){ bestR=rr; best=seed; bestDesc='refl='+refl+' deg='+deg; }
    }
  }
  return {seed:best, bestResidual:bestR, desc:bestDesc};
}

const {seed, bestResidual, desc} = deriveSeed();
const ctx = {GFC_COLS, ETABS_COLS, ETABS_WALLS};
const maxCap = 1e9;   // threshold slider wide open (no cap) for the oracle baseline
const out = E.runColumnMatch(seed, ctx, maxCap);

const golden = {
  source: path.basename(contractPath),
  gfc_count: GFC_COLS.length, etabs_count: ETABS_COLS.length, wall_count: ETABS_WALLS.length,
  seed_mean_residual: +bestResidual.toFixed(2),
  anisotropy: out.anisotropy,
  counts: out.counts,
  // stable, comparable match map: gfc_id -> {etabs_id, confidence, dist}
  matches: out.matchResult
    .filter(m=>m.gfc_id)
    .sort((a,b)=>a.gfc_id<b.gfc_id?-1:1)
    .map(m=>({gfc_id:m.gfc_id, etabs_id:m.etabs_id, confidence:m.confidence, dist:m.dist,
              ratio:m.ratio, mutual:!!m.mutual, posdev:!!m.posdev, pier:m.pier||null})),
  unmatched_etabs: out.matchResult.filter(m=>m.confidence==='UNMATCHED_ETABS')
    .map(m=>m.etabs_id).sort()
};

const outPath = path.join(__dirname, 'golden_oracle.json');
fs.writeFileSync(outPath, JSON.stringify(golden, null, 1));
console.log('ORACLE written:', outPath);
console.log('  seed:', desc, '| mean residual:', golden.seed_mean_residual, 'mm | anisotropy:', golden.anisotropy);
console.log('  counts:', JSON.stringify(golden.counts));
console.log('  matched HIGH+MED:', golden.counts.HIGH+golden.counts.MED,
            '| walls:', golden.counts.WALL, '| unmatched ETABS:', golden.counts.UNMATCHED_ETABS);
