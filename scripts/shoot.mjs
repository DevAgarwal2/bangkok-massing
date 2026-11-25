import puppeteer from 'puppeteer-core';

const url = process.argv[2] ?? 'http://localhost:4321/';
const out = process.argv[3] ?? '/tmp/shot.png';
const w = Number(process.argv[4] ?? 1680);
const h = Number(process.argv[5] ?? 1000);

const browser = await puppeteer.launch({
  executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: 'new',
  args: ['--enable-unsafe-swiftshader', '--hide-scrollbars', '--no-first-run', '--no-default-browser-check'],
  defaultViewport: { width: w, height: h, deviceScaleFactor: 1 },
});

const page = await browser.newPage();
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => logs.push(`[reqfail] ${r.url()} ${r.failure()?.errorText}`));

await page.goto(url, { waitUntil: 'networkidle0', timeout: 45000 });
await new Promise((r) => setTimeout(r, 3500));
await page.screenshot({ path: out });

const info = await page.evaluate(() => {
  const c = document.querySelector('canvas');
  const gl = c?.getContext('webgl2') || c?.getContext('webgl');
  return {
    canvas: c ? [c.width, c.height] : null,
    webgl: !!gl,
    renderer: gl ? gl.getParameter(gl.getExtension('WEBGL_debug_renderer_info')?.UNMASKED_RENDERER_WEBGL ?? gl.VERSION) : null,
    rules: document.querySelectorAll('.rule').length,
    schemes: document.querySelectorAll('.scheme').length,
    figs: document.querySelectorAll('#figure svg').length,
    plotArea: document.querySelector('[data-count="plotArea"]')?.textContent,
    envArea: document.querySelector('[data-count="envelope"]')?.textContent,
    gfa: document.querySelector('.scheme.on .scheme-mid')?.textContent?.trim(),
    bodyH: document.body.scrollHeight,
  };
});

console.log(JSON.stringify(info, null, 2));
if (logs.length) console.log(logs.join('\n'));
await browser.close();
