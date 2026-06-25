// Exercise the Name-the-columns flow: enter naming mode, click 3 column+mark
// pairs by reading the contract, then screenshot the named result.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');

(async () => {
  const url = process.argv[2] || 'http://127.0.0.1:3016/';
  const outDir = path.join(__dirname, '..', 'probe');
  const contract = JSON.parse(fs.readFileSync(
    path.join(__dirname, '..', '..', 'frontend', 'public', 'gwalior_live.json'), 'utf8'));
  const cols = contract.gfc_cols, marks = contract.schedule.cmark_layer.marks;

  // fitView math (mirror render.ts) to convert world -> canvas px
  const xs = cols.map(c => c.cx), ys = cols.map(c => c.cy);
  const minx = Math.min(...xs), maxx = Math.max(...xs), miny = Math.min(...ys), maxy = Math.max(...ys);
  const pad = 40, W = 620, H = 460;
  const scale = Math.min((W - 2 * pad) / (maxx - minx), (H - 2 * pad) / (maxy - miny));
  const ox = pad - minx * scale, oy = pad - miny * scale;
  const toPx = (x, y) => [x * scale + ox, y * scale + oy];
  const nearestMark = (col) => { let bd = 1e9, bm = null; for (const m of marks) { const d = Math.hypot(col.cx - m.x, col.cy - m.y); if (d < bd) { bd = d; bm = m; } } return bm; };

  const byx = [...cols].sort((a, b) => a.cx - b.cx);
  const picks = [byx[0], byx[Math.floor(byx.length / 2)], byx[byx.length - 1]];

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1360, height: 1000 } });
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(600);

  // enter naming mode
  await page.getByRole('button', { name: /Name columns/i }).click();
  await page.waitForTimeout(300);

  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  const clickAt = async (wx, wy) => {
    const [px, py] = toPx(wx, wy);
    await page.mouse.click(box.x + (px / W) * box.width, box.y + (py / H) * box.height);
    await page.waitForTimeout(250);
  };
  // click 3 pairs: column then its name mark
  for (const col of picks) {
    const m = nearestMark(col);
    await clickAt(col.cx, col.cy);   // pick column
    await clickAt(m.x, m.y);         // pick its mark
  }
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(outDir, 'mapper_named.png'), fullPage: true });
  console.log('shot: mapper_named.png');
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
