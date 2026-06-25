import { chromium } from '@playwright/test';
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setViewportSize({ width: 1440, height: 900 });
await page.goto('http://localhost:3456/project/c199f54c74c7/floor', { waitUntil: 'networkidle', timeout: 20000 });
await page.waitForTimeout(2500);
await page.screenshot({ path: 'C:/Users/Admin/AppData/Local/Temp/claude/d--ETABS-and-Drawing-Proofchecking/3f822e09-3967-4ec3-b700-51d995b07617/scratchpad/floor_page.png', fullPage: false });
await browser.close();
console.log('done');
