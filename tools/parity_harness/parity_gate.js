// PARITY GATE — proves the TypeScript engine (lib/engine/*.ts) reproduces the
// golden oracle EXACTLY on the Gwalior contract. The hard gate from the plan:
// the TS rewrite is not trusted until this diff is empty.
//
// Uses esbuild to transpile + bundle the TS engine to CJS, then runs it against
// golden_oracle.json (produced by make_oracle.js from the verbatim v10 engine).

const fs = require('fs');
const path = require('path');
const esbuild = require('esbuild');

const ROOT = path.join(__dirname, '..', '..');

// bundle a tiny shim that re-exports everything the harness needs from the engine
const shim = `
export { runColumnMatch, hungarian, PIER_TOL } from './match';
export { deriveSeed, solveAffine, applyAffine, fitSimilarity, icpRefine, linAnisotropy, distSeg } from './geometry';
`;
const shimPath = path.join(ROOT, 'frontend', 'lib', 'engine', '__paritytest_entry.ts');
fs.writeFileSync(shimPath, shim);
let TS;
try {
  const res = esbuild.buildSync({
    entryPoints: [shimPath], bundle: true, format: 'cjs', platform: 'node', write: false,
  });
  const moduleObj = { exports: {} };
  new Function('module', 'exports', 'require', res.outputFiles[0].text)(moduleObj, moduleObj.exports, require);
  TS = moduleObj.exports;
} finally {
  fs.unlinkSync(shimPath);
}

const contractPath = path.join(ROOT, 'backend', 'fixtures', 'sample_gwalior_contract.json');
const C = JSON.parse(fs.readFileSync(contractPath, 'utf8'));
const golden = JSON.parse(fs.readFileSync(path.join(__dirname, 'golden_oracle.json'), 'utf8'));

const { seed } = TS.deriveSeed(C.gfc_cols, C.etabs_cols);
const out = TS.runColumnMatch(seed, { GFC_COLS: C.gfc_cols, ETABS_COLS: C.etabs_cols, ETABS_WALLS: C.etabs_walls }, 1e9);

const tsMatches = out.matchResult.filter((m) => m.gfc_id)
  .sort((a, b) => (a.gfc_id < b.gfc_id ? -1 : 1))
  .map((m) => ({ gfc_id: m.gfc_id, etabs_id: m.etabs_id, confidence: m.confidence, dist: m.dist,
                 ratio: m.ratio, mutual: !!m.mutual, posdev: !!m.posdev, pier: m.pier || null }));
const tsUnmatched = out.matchResult.filter((m) => m.confidence === 'UNMATCHED_ETABS').map((m) => m.etabs_id).sort();

const diffs = [];
const cmp = (label, a, b) => { if (JSON.stringify(a) !== JSON.stringify(b)) diffs.push(`${label}: TS=${JSON.stringify(a)} vs ORACLE=${JSON.stringify(b)}`); };
cmp('counts', out.counts, golden.counts);
cmp('anisotropy', +out.anisotropy.toFixed(4), golden.anisotropy);
cmp('unmatched_etabs', tsUnmatched, golden.unmatched_etabs);
if (tsMatches.length !== golden.matches.length) diffs.push(`match count: TS=${tsMatches.length} vs ORACLE=${golden.matches.length}`);
else {
  let mismatched = 0;
  for (let i = 0; i < tsMatches.length; i++) {
    if (JSON.stringify(tsMatches[i]) !== JSON.stringify(golden.matches[i])) {
      mismatched++;
      if (mismatched <= 5) diffs.push(`match[${golden.matches[i].gfc_id}]: TS=${JSON.stringify(tsMatches[i])} vs ORACLE=${JSON.stringify(golden.matches[i])}`);
    }
  }
  if (mismatched) diffs.push(`...${mismatched} match rows differ`);
}

console.log('TS engine counts:', JSON.stringify(out.counts));
console.log('Oracle    counts:', JSON.stringify(golden.counts));
if (diffs.length === 0) {
  console.log('\n[OK] PARITY GATE PASSED - TS engine == oracle on Gwalior (empty diff)');
  process.exit(0);
} else {
  console.log('\n[FAIL] PARITY GATE - differences:');
  diffs.forEach((d) => console.log('  ', d));
  process.exit(1);
}
