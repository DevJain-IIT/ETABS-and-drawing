// Quick screenshot of the running mapper: initial load + after running the match.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:3014/';
  const outDir = path.join(__dirname, '..', 'probe');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'mapper_initial.png'), fullPage: true });
  console.log('shot: mapper_initial.png');

  // click "Refine & match"
  const btn = page.getByRole('button', { name: /match/i }).first();
  await btn.click();
  await page.waitForTimeout(1200);
  await page.screenshot({ path: path.join(outDir, 'mapper_matched.png'), fullPage: true });
  console.log('shot: mapper_matched.png');

  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
