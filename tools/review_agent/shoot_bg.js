// Quick screenshot: navigate to the most recent project's naming page and capture it.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

const BASE = process.argv[2] || 'http://localhost:3456';
const PROBE = path.join(__dirname, '..', 'probe');
fs.mkdirSync(PROBE, { recursive: true });

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 900 } });
  // find a project — try projects list with test email, fall back to direct id from argv
  let nameUrl = process.argv[3] ? (BASE + '/project/' + process.argv[3] + '/name') : null;
  if (!nameUrl) {
    await page.goto(BASE + '/projects?email=review%40civilspace.test', { waitUntil: 'networkidle', timeout: 20000 });
    const links = await page.locator('a[href*="/project/"]').all();
    for (const l of links) {
      const href = await l.getAttribute('href');
      if (href && href.includes('/project/') && !href.includes('/name')) { nameUrl = BASE + href + '/name'; break; }
    }
  }
  if (!nameUrl) {
    console.log('no project found — pass a project id as argv[3]');
    await browser.close();
    return;
  }
  console.log('opening', nameUrl);
  await page.goto(nameUrl, { waitUntil: 'networkidle', timeout: 30000 });
  await page.waitForTimeout(3500);   // allow raster image to load + paint
  await page.screenshot({ path: path.join(PROBE, 'bg_naming_default.png'), fullPage: true });
  console.log('screenshot saved: bg_naming_default.png');

  // also drag the slider to 30% to see the drawing more clearly
  const slider = page.locator('input[type=range]').first();
  if (await slider.count()) {
    await slider.fill('0.3');
    await slider.dispatchEvent('input');
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(PROBE, 'bg_naming_30pct.png'), fullPage: true });
    console.log('screenshot saved: bg_naming_30pct.png  (overlay at 30%)');
  }
  await browser.close();
})().catch((e) => { console.error('shoot_bg crashed:', e.message); process.exit(1); });
