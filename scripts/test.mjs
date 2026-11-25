import puppeteer from 'puppeteer-core';

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars'],
  defaultViewport: { width: 1680, height: 1000, deviceScaleFactor: 1 },
});
const page = await browser.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') logs.push(`[console] ${m.text()}`); });

await page.goto('http://localhost:4321/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));

// 1) second scheme
await page.click('.scheme[data-i="1"]');
await new Promise((r) => setTimeout(r, 1800));
await page.screenshot({ path: '/tmp/t-terrace.png' });
const s2 = await page.$eval('.scheme.on .scheme-n', (e) => e.textContent);

// 2) zone change
await page.select('#zoneSelect', 'ย.4');
await new Promise((r) => setTimeout(r, 1200));
const z1 = await page.$eval('#zoneTag', (e) => e.textContent);
const gfa1 = await page.$eval('.scheme.on .scheme-mid', (e) => e.textContent.replace(/\s+/g, ' '));

// 3) program change
await page.evaluate(() => document.querySelector('[data-prog="office"]')?.click());
await new Promise((r) => setTimeout(r, 1200));
const gfa2 = await page.$eval('.scheme.on .scheme-mid', (e) => e.textContent.replace(/\s+/g, ' '));
await page.screenshot({ path: '/tmp/t-office.png' });

// 4) draw mode: click 3 points on canvas
await page.click('#drawBtn');
const box = await page.$eval('#view', (c) => { const r = c.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
for (const [fx, fy] of [[0.42, 0.55], [0.55, 0.52], [0.6, 0.65], [0.45, 0.68]]) {
  await page.mouse.click(box.x + box.w * fx, box.y + box.h * fy);
  await new Promise((r) => setTimeout(r, 200));
}
await page.keyboard.press('Enter');
await new Promise((r) => setTimeout(r, 1600));
const drawn = await page.$eval('[data-count="plotArea"]', (e) => e.textContent);
await page.screenshot({ path: '/tmp/t-drawn.png' });

// 5) mobile
const m = await browser.newPage();
await m.setViewport({ width: 390, height: 844, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
await m.goto('http://localhost:4321/', { waitUntil: 'networkidle0' });
await new Promise((r) => setTimeout(r, 2500));
await m.screenshot({ path: '/tmp/t-mobile.png', fullPage: false });

console.log(JSON.stringify({ scheme2: s2, zone: z1, gfaAfterY4: gfa1, gfaOffice: gfa2, drawnArea: drawn, errors: logs }, null, 2));
await browser.close();
