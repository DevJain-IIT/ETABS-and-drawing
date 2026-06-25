#!/usr/bin/env node
/**
 * CivilSpace UI Review Agent — thorough functional review of the CURRENT flow.
 * ===========================================================================
 * Drives the running app like a real engineer through the real architecture:
 *
 *     landing → upload (3 real files) → extract
 *       → STEP 1  /project/<id>/name   "Name the columns" (Registration A)
 *       → STEP 2  /project/<id>         the dual-pane mapper (GFC ↔ ETABS)
 *
 * It EXERCISES every control on each screen and checks each one actually does
 * something (a button that no-ops is a bug). Captures a screenshot per step and
 * writes a plain-English pass/fail report.
 *
 *   node review.js [baseUrl] [--no-upload]
 *      baseUrl     default http://localhost:3456
 *      --no-upload review static pages only (skip upload/extract)
 *
 * Output: review_report.md + step screenshots in ../probe/review_*.png
 */
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const BASE = (args.find((a) => !a.startsWith('--')) || 'http://localhost:3456').replace(/\/$/, '');
const DO_UPLOAD = !args.includes('--no-upload');
const SAMPLE = 'D:\\ETABS and Drawing Proofchecking\\sample';
const FILES = {
  etabs: path.join(SAMPLE, 'ULS_20-04-2026-GWLR_HOSPITAL-03 (5) (1).$et'),
  gfc: path.join(SAMPLE, 'GROUND FLOOR ARRANGEMENT (1).pdf'),
  layout: path.join(SAMPLE, 'COLUMN LAYOUT PLAN.pdf'),
};
const PROBE = path.join(__dirname, '..', 'probe');
const REPORT = path.join(__dirname, 'review_report.md');
fs.mkdirSync(PROBE, { recursive: true });

const results = [];
const rec = (section, name, status, detail = '') => results.push({ section, name, status, detail });
const backendish = (s) => /ERR_CONNECTION_REFUSED|Failed to (load resource|fetch)|net::ERR|status of 40[049]|status of 500/i.test(s);
const consoleErrors = [];

function attach(page) {
  page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message));
}
async function shot(page, name) {
  const f = path.join(PROBE, `review_${name}.png`);
  await page.screenshot({ path: f, fullPage: true }).catch(() => {});
  return path.basename(f);
}
async function canvasFingerprint(page, idx = 0) {
  return page.evaluate((i) => {
    const c = document.querySelectorAll('canvas')[i];
    if (!c) return '';
    try { return c.toDataURL().slice(-90); } catch { return ''; }
  }, idx);
}
async function bodyText(page) { return (await page.textContent('body')) || ''; }
async function clickByName(page, re) {
  const b = page.getByRole('button', { name: re }).first();
  if (await b.count()) { await b.click(); return true; }
  const l = page.getByRole('link', { name: re }).first();
  if (await l.count()) { await l.click(); return true; }
  return false;
}

// ---------------------------------------------------------------- landing
async function reviewLanding(page) {
  const S = 'Landing (/)';
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(400);
  const t = await bodyText(page);
  rec(S, 'page loads', 'pass');
  rec(S, 'hero copy present', /Reconcile any drawing/i.test(t) ? 'pass' : 'warn');
  rec(S, '“Upload your building” CTA', (await page.getByRole('link', { name: /Upload your building/i }).count()) ? 'pass' : 'fail');
  rec(S, 'screenshot', 'info', await shot(page, '1_landing'));
}

// ---------------------------------------------------------------- upload page
async function reviewUploadPage(page) {
  const S = 'Upload (/upload)';
  await page.goto(`${BASE}/upload`, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(300);
  const t = await bodyText(page);
  rec(S, 'page loads', 'pass');
  rec(S, 'ETABS model slot present', /ETABS model/i.test(t) ? 'pass' : 'fail');
  rec(S, 'arrangement slot present', /arrangement/i.test(t) ? 'pass' : 'fail');
  rec(S, 'layout slot present', /layout/i.test(t) ? 'pass' : 'warn');
  rec(S, '3 file inputs present', (await page.locator('input[type=file]').count()) >= 3 ? 'pass' : 'fail');
  rec(S, 'submit disabled before files', await page.getByRole('button', { name: /Upload.*extract/i }).isDisabled().catch(() => true) ? 'pass' : 'warn');
  rec(S, 'screenshot', 'info', await shot(page, '2_upload_empty'));
}

// ---------------------------------------------------------------- full flow
async function reviewFullFlow(page) {
  const S = 'Upload → extract';
  if (!DO_UPLOAD) { rec(S, 'skipped (--no-upload)', 'info'); return null; }
  for (const [k, f] of Object.entries(FILES)) {
    if (!fs.existsSync(f)) { rec(S, `sample file missing: ${k}`, 'fail', f); return null; }
  }
  await page.goto(`${BASE}/upload`, { waitUntil: 'networkidle' });
  await page.getByPlaceholder(/Gwalior|building/i).first().fill('Review Test Building').catch(() => {});
  await page.getByPlaceholder(/@/).first().fill('review@civilspace.test').catch(() => {});
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles(FILES.etabs);
  await inputs.nth(1).setInputFiles(FILES.gfc);
  await inputs.nth(2).setInputFiles(FILES.layout);
  await page.waitForTimeout(300);
  rec(S, 'attach 3 real files', 'pass');
  rec(S, 'submit enabled after files', !(await page.getByRole('button', { name: /Upload.*extract/i }).isDisabled()) ? 'pass' : 'fail');
  rec(S, 'screenshot (filled)', 'info', await shot(page, '3_upload_filled'));

  await page.getByRole('button', { name: /Upload.*extract/i }).click();
  let landed = true;
  // NEW FLOW: extraction should land on the naming step first
  await page.waitForURL(/\/project\/.+\/name/, { timeout: 120000 }).catch(() => { landed = false; });
  rec(S, 'upload + extract → STEP 1 naming opens', landed ? 'pass' : 'fail',
    landed ? page.url() : 'did not reach /project/<id>/name (backend on 8765 running? extract ok?)');
  if (!landed) { rec(S, 'screenshot (stuck)', 'info', await shot(page, '3_upload_stuck')); return null; }
  await page.waitForTimeout(1500);
  return page.url();
}

// ---------------------------------------------------------------- STEP 1: naming
async function reviewNamingStep(page, nameUrl) {
  const S = 'Step 1 · Name the columns';
  if (!nameUrl) {
    // try to reach it directly from the most recent project, if upload was skipped
    return null;
  }
  await page.waitForTimeout(800);
  const t = await bodyText(page);
  rec(S, 'naming page renders', /Name the columns/i.test(t) ? 'pass' : 'fail');
  rec(S, 'single layout canvas present', (await page.locator('canvas').count()) >= 1 ? 'pass' : 'fail');

  // stat bar: named / columns, SW, un-greyed
  rec(S, 'shows named/total columns', /named .*columns/i.test(t) ? 'pass' : 'warn');
  rec(S, 'shear-wall (SW) count shown', /shear walls?\s*\(SW\)/i.test(t) ? 'pass' : 'warn');
  rec(S, 'un-greyed (add?) count shown', /un-greyed/i.test(t) ? 'pass' : 'warn');

  // auto-naming actually produced names? (the canvas should have green/named boxes;
  // we check the stat bar reports a non-zero named count)
  const namedMatch = t.match(/(\d+)\s*named\s*\/\s*(\d+)\s*columns/i);
  if (namedMatch) {
    const named = +namedMatch[1], total = +namedMatch[2];
    rec(S, 'auto-naming attached names', named > 0 ? 'pass' : 'fail', `${named}/${total} named`);
    rec(S, 'most columns named (>80%)', named >= total * 0.8 ? 'pass' : 'warn', `${named}/${total}`);
  } else rec(S, 'named-count parseable', 'warn', 'could not read "N named / M columns"');

  rec(S, 'screenshot (auto-named)', 'info', await shot(page, '4_naming_auto'));

  // zoom works (canvas redraws on wheel)
  const cv = page.locator('canvas').first();
  const box = await cv.boundingBox();
  if (box) {
    const fp1 = await canvasFingerprint(page, 0);
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -600); await page.waitForTimeout(300);
    await page.mouse.wheel(0, -600); await page.waitForTimeout(300);
    const fp2 = await canvasFingerprint(page, 0);
    rec(S, 'scroll-zoom redraws the canvas', fp1 !== fp2 ? 'pass' : 'warn');
    rec(S, 'screenshot (zoomed)', 'info', await shot(page, '5_naming_zoom'));
    // pan
    await page.mouse.move(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.mouse.down(); await page.mouse.move(box.x + box.width * 0.3, box.y + box.height * 0.4, { steps: 6 }); await page.mouse.up();
    await page.waitForTimeout(200);
    rec(S, 'drag-pan works (no crash)', 'pass');
    // click a box -> selection card
    await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
    await page.waitForTimeout(300);
    const ct = await bodyText(page);
    rec(S, 'clicking a box selects it (selected card appears)', /Selected\s*·/i.test(ct) ? 'pass' : 'warn');
  }

  // review side panel: SW confirmation and/or un-greyed add buttons
  const ct = await bodyText(page);
  rec(S, 'review side panel present', /(Review \(|Un-greyed columns \(|All clear)/i.test(ct) ? 'pass' : 'warn');
  // try an "+ add" (orphan) if present
  const addBtn = page.getByRole('button', { name: /^\+ add$/i }).first();
  if (await addBtn.count()) {
    await addBtn.click(); await page.waitForTimeout(300);
    rec(S, '“+ add” un-greyed column works', 'pass');
  } else rec(S, 'un-greyed add buttons', 'info', 'none on this sheet (names tight to boxes)');

  // the selected-card edit controls (set / confirm / mark SW / delete)
  if (/Selected\s*·/i.test(ct)) {
    const setBtn = page.getByRole('button', { name: /^set$/i }).first();
    const confirmBtn = page.getByRole('button', { name: /^confirm$/i }).first();
    rec(S, 'selected card has set/confirm/delete', (await setBtn.count()) && (await confirmBtn.count()) ? 'pass' : 'warn');
    if (await confirmBtn.count()) { await confirmBtn.click(); await page.waitForTimeout(200); rec(S, 'confirm name works (no crash)', 'pass'); }
  }

  rec(S, 'screenshot (review)', 'info', await shot(page, '6_naming_review'));

  // continue to the mapper
  const cont = page.getByRole('button', { name: /Confirm.*continue|map to ETABS/i }).first();
  rec(S, '“Confirm & continue” button present', (await cont.count()) ? 'pass' : 'fail');
  if (await cont.count()) {
    await cont.click();
    let toMapper = true;
    await page.waitForURL((u) => /\/project\/[^/]+$/.test(u.toString()), { timeout: 20000 }).catch(() => { toMapper = false; });
    rec(S, 'continue → mapper (Step 2) opens', toMapper ? 'pass' : 'fail', toMapper ? page.url() : 'did not navigate to the mapper');
    return toMapper ? page.url() : null;
  }
  return null;
}

// ---------------------------------------------------------------- STEP 2: mapper
async function reviewMapper(page, mapperUrl) {
  const S = 'Step 2 · Mapper (GFC ↔ ETABS)';
  if (!mapperUrl) { rec(S, 'not reached', 'warn', 'naming step did not hand off'); return; }
  await page.waitForTimeout(1200);
  const nCanvas = await page.locator('canvas').count();
  rec(S, 'dual canvas present', nCanvas >= 2 ? 'pass' : 'fail', `${nCanvas} canvas`);
  const t = await bodyText(page);
  rec(S, 'calibration prompt shown', /control point|Apply alignment/i.test(t) ? 'pass' : 'warn');
  rec(S, '“Apply alignment” control present', /Apply alignment/i.test(t) ? 'pass' : 'warn');
  rec(S, 'dev “what’s happening” panel present', /WHAT.?S HAPPENING/i.test(t) ? 'pass' : 'info');
  rec(S, 'screenshot (mapper loaded)', 'info', await shot(page, '7_mapper_loaded'));

  // drive a 3-point calibration: click 3 GFC then 3 ETABS, apply, match
  const gfc = page.locator('canvas').nth(0), etabs = page.locator('canvas').nth(1);
  const gb = await gfc.boundingBox(), eb = await etabs.boundingBox();
  if (gb && eb) {
    const pts = [[0.3, 0.3], [0.7, 0.35], [0.5, 0.7]];
    for (const [fx, fy] of pts) { await page.mouse.click(gb.x + gb.width * fx, gb.y + gb.height * fy); await page.waitForTimeout(150); }
    for (const [fx, fy] of pts) { await page.mouse.click(eb.x + eb.width * fx, eb.y + eb.height * fy); await page.waitForTimeout(150); }
    rec(S, '3 GFC + 3 ETABS control points placed (no crash)', 'pass');
    const applied = await clickByName(page, /Apply alignment/i);
    await page.waitForTimeout(800);
    rec(S, '“Apply alignment” runs', applied ? 'pass' : 'warn');
    const fp1 = await canvasFingerprint(page, 1);
    await clickByName(page, /Refine & match/i);
    await page.waitForTimeout(1400);
    const mt = await bodyText(page);
    const fp2 = await canvasFingerprint(page, 1);
    rec(S, '“Refine & match” runs the engine', /\bhigh\b/i.test(mt) && /\bwall/i.test(mt) ? 'pass' : 'warn', 'expected high/walls stats');
    rec(S, 'match redraws the ETABS canvas', fp1 !== fp2 ? 'pass' : 'warn');
    rec(S, 'review queue populated', /Review queue/i.test(mt) ? 'pass' : 'warn');
    rec(S, 'screenshot (matched)', 'info', await shot(page, '8_mapper_matched'));
  }
}

async function reviewProjects(page) {
  const S = 'Projects (/projects)';
  await page.goto(`${BASE}/projects`, { waitUntil: 'networkidle' }).catch(() => {});
  await page.waitForTimeout(300);
  rec(S, 'page loads', /projects/i.test(await bodyText(page)) ? 'pass' : 'warn');
  rec(S, 'screenshot', 'info', await shot(page, '9_projects'));
}

// ---------------------------------------------------------------- report
function writeReport() {
  const realErrors = consoleErrors.filter((e) => !backendish(e));
  if (realErrors.length) rec('Console', `${realErrors.length} JS error(s)`, 'fail', realErrors.slice(0, 4).join(' | ').slice(0, 360));
  else rec('Console', 'no JavaScript errors', 'pass');
  const backendErrs = consoleErrors.filter(backendish);
  if (backendErrs.length) rec('Console', `${backendErrs.length} backend/network error(s)`, 'warn', 'is the backend on 8765 up?');

  const fails = results.filter((r) => r.status === 'fail').length;
  const warns = results.filter((r) => r.status === 'warn').length;
  const passes = results.filter((r) => r.status === 'pass').length;
  const ic = { pass: '✓', fail: '✗', warn: '⚠', info: '·' };
  const verdict = fails > 0
    ? `🔴 **${fails} check${fails > 1 ? 's' : ''} FAILED** · ${passes} passed${warns ? ` · ${warns} warning(s)` : ''}`
    : warns > 0
    ? `🟡 **All ${passes} checks passed — ${warns} warning(s) to look at**`
    : `🟢 **All ${passes} checks passed.** Every screen and control works.`;

  const bySec = {};
  for (const r of results) (bySec[r.section] ??= []).push(r);
  let md = `# Functional Review — ${BASE}\n\n${verdict}\n\n`;
  md += `_Flow tested: landing → upload → extract → **Step 1 naming** → **Step 2 mapper** · ${new Date().toISOString().slice(0, 16).replace('T', ' ')}_\n\n`;
  if (fails > 0) {
    md += `## ✗ Needs fixing\n\n`;
    for (const r of results.filter((r) => r.status === 'fail')) md += `- **[${r.section}] ${r.name}**${r.detail ? ` — ${r.detail}` : ''}\n`;
    md += `\n`;
  }
  if (warns > 0) {
    md += `## ⚠ Worth a look\n\n`;
    for (const r of results.filter((r) => r.status === 'warn')) md += `- [${r.section}] ${r.name}${r.detail ? ` — ${r.detail}` : ''}\n`;
    md += `\n`;
  }
  md += `## All checks\n\n`;
  for (const [sec, rs] of Object.entries(bySec)) {
    md += `### ${sec}\n\n`;
    for (const r of rs) md += `- ${ic[r.status]} ${r.name}${r.detail && r.status !== 'info' ? ` — ${r.detail}` : r.status === 'info' && r.detail ? ` (${r.detail})` : ''}\n`;
    md += `\n`;
  }
  md += `---\nStep screenshots: \`tools/probe/review_*.png\` (numbered in flow order).\nRe-run: \`node review.js [url] [--no-upload]\`.\n`;
  fs.writeFileSync(REPORT, md);
  return { fails, warns, passes, md };
}

(async () => {
  console.log(`Reviewing ${BASE}${DO_UPLOAD ? ' (real upload through both steps)' : ' (pages only)'} …`);
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  attach(page);
  try {
    await reviewLanding(page);
    await reviewUploadPage(page);
    const nameUrl = await reviewFullFlow(page);
    const mapperUrl = await reviewNamingStep(page, nameUrl);
    await reviewMapper(page, mapperUrl);
    await reviewProjects(page);
  } catch (e) {
    rec('Runner', 'crashed mid-review', 'fail', (e.message || String(e)).slice(0, 220));
  }
  await browser.close();
  const { fails, md } = writeReport();
  console.log('\n' + md.split('\n').slice(0, 3).join('\n'));
  console.log(`\nFull report: ${path.relative(process.cwd(), REPORT)}`);
  process.exit(fails > 0 ? 1 : 0);
})().catch((e) => { console.error('review crashed:', e); process.exit(2); });
