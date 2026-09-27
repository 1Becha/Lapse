// Renders docs/social-preview.png (1280x640) for GitHub's Settings -> Social preview:
// the name and tagline next to a real dashboard screenshot with demo data.
//
//   npm run demo:preview      (needs Chrome or Edge)
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer from 'puppeteer-core';
import { Store } from '../src/store.ts';
import { seedDemo } from './demo-data.ts';

const PORT = 3998;
const BASE = `http://localhost:${PORT}`;
const OUT = resolve('docs/social-preview.png');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const work = mkdtempSync(join(tmpdir(), 'lapse-preview-'));
const dataDir = join(work, 'data');
const store = new Store(join(dataDir, 'lapse.db'));
seedDemo(store);
store.db.close();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(PORT),
  LAPSE_DATA_DIR: dataDir,
  LAPSE_BASE_URL: BASE,
  LAPSE_AI_PROVIDER: 'none',
  LAPSE_SCHEDULER: 'off',
};
delete env.LAPSE_USER;
delete env.LAPSE_PASSWORD;
const server = spawn(process.execPath, ['--disable-warning=ExperimentalWarning', 'src/server.ts'], {
  env,
  stdio: ['ignore', 'ignore', 'inherit'],
});

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 50; i++) {
    try {
      if ((await fetch(`${BASE}/health`)).ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error('Lapse did not start');
}

const card = (screenshot: string) => `<!doctype html>
<html><head><meta charset="utf-8"><style>
  * { box-sizing: border-box; margin: 0; }
  body {
    width: 1280px; height: 640px; overflow: hidden; position: relative;
    background: radial-gradient(1200px 600px at 85% 20%, #2a3a8f 0%, #151a33 55%, #0e1022 100%);
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #fff;
  }
  .text { position: absolute; left: 80px; top: 0; bottom: 0; width: 470px; display: flex; flex-direction: column; justify-content: center; }
  .logo { font-size: 84px; font-weight: 800; letter-spacing: -0.03em; line-height: 1; }
  .logo span { font-size: 70px; margin-right: 8px; }
  .tagline { margin-top: 26px; font-size: 38px; font-weight: 700; line-height: 1.2; letter-spacing: -0.01em; }
  .tagline em { font-style: normal; color: #ffb86b; }
  .sub { margin-top: 22px; font-size: 21px; line-height: 1.45; color: #b9c0e6; }
  .pills { margin-top: 28px; display: flex; gap: 10px; flex-wrap: wrap; }
  .pills b { font-size: 15px; font-weight: 600; padding: 6px 12px; border-radius: 99px; background: rgba(255,255,255,.1); color: #dfe3ff; }
  .shot {
    position: absolute; left: 610px; top: 70px; width: 820px; border-radius: 14px; overflow: hidden;
    box-shadow: 0 30px 80px rgba(0,0,0,.55), 0 0 0 1px rgba(255,255,255,.08);
    transform: perspective(1600px) rotateY(-9deg) rotateX(3deg); transform-origin: left center;
  }
  .shot img { display: block; width: 100%; }
</style></head><body>
  <div class="text">
    <div class="logo"><span>⏳</span>Lapse</div>
    <div class="tagline">Never miss the deadline <em>before</em> the deadline.</div>
    <div class="sub">Tracks contracts, certificates and everything that expires, and tells you the real last day to act.</div>
    <div class="pills"><b>Self-hosted</b><b>Reads contract PDFs</b><b>Open source</b></div>
  </div>
  <div class="shot"><img src="data:image/png;base64,${screenshot}"></div>
</body></html>`;

try {
  await waitForServer();
  const executablePath = BROWSERS.find((p) => p && existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);
    await page.setViewport({ width: 1100, height: 720, deviceScaleFactor: 2 });
    await page.goto(`${BASE}/`);
    const shot = Buffer.from(await page.screenshot({ type: 'png' })).toString('base64');

    await page.setViewport({ width: 1280, height: 640, deviceScaleFactor: 1 });
    await page.setContent(card(shot), { waitUntil: 'load' });
    mkdirSync('docs', { recursive: true });
    await page.screenshot({ path: OUT as `${string}.png` });
    console.log(`Wrote ${OUT}`);
  } finally {
    await browser.close();
  }
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}
