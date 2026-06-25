// End-to-end: drive the upload page (real files) -> extract -> mapper on live project.
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const base = process.argv[2] || 'http://127.0.0.1:3022';
  const S = 'D:\\ETABS and Drawing Proofchecking\\sample';
  const outDir = path.join(__dirname, '..', 'probe');
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });

  await page.goto(`${base}/upload`, { waitUntil: 'networkidle' });
  await page.screenshot({ path: path.join(outDir, 'e2e_upload.png'), fullPage: true });

  await page.getByPlaceholder('e.g. Gwalior Hospital ULS').fill('Gwalior Hospital ULS');
  await page.getByPlaceholder('you@firm.com').fill('aiplanner04@gmail.com');

  // attach the 3 real files to the 3 hidden inputs (in slot order)
  const inputs = page.locator('input[type=file]');
  await inputs.nth(0).setInputFiles(path.join(S, 'ULS_20-04-2026-GWLR_HOSPITAL-03 (5) (1).$et'));
  await inputs.nth(1).setInputFiles(path.join(S, 'GROUND FLOOR ARRANGEMENT (1).pdf'));
  await inputs.nth(2).setInputFiles(path.join(S, 'COLUMN LAYOUT PLAN.pdf'));
  await page.waitForTimeout(400);
  await page.screenshot({ path: path.join(outDir, 'e2e_upload_filled.png'), fullPage: true });

  await page.getByRole('button', { name: /Upload.*extract/i }).click();
  // wait for navigation to the mapper (?project=)
  await page.waitForURL(/\/\?project=/, { timeout: 60000 });
  await page.waitForTimeout(1500);
  // run the match on the live project
  await page.getByRole('button', { name: /match/i }).first().click();
  await page.waitForTimeout(1500);
  await page.screenshot({ path: path.join(outDir, 'e2e_mapper_live.png'), fullPage: true });
  console.log('E2E OK -> e2e_mapper_live.png  (url:', page.url(), ')');
  await browser.close();
})().catch((e) => { console.error('E2E FAIL:', e.message); process.exit(1); });
