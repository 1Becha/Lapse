// Records docs/demo.gif: seeds demo data, starts Lapse, clicks through it in Chrome
// and assembles the captioned screenshots with ffmpeg.
//
//   npm run demo:gif      (needs Chrome or Edge, and ffmpeg on PATH)
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import puppeteer, { type Page } from 'puppeteer-core';
import { Store } from '../src/store.ts';
import { seedDemo } from './demo-data.ts';

const PORT = 3999;
const BASE = `http://localhost:${PORT}`;
const VIEWPORT = { width: 1100, height: 720 };
const OUT = resolve('docs/demo.gif');

const BROWSERS = [
  process.env.CHROME_PATH,
  'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
  'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
];

const work = mkdtempSync(join(tmpdir(), 'lapse-demo-'));
const dataDir = join(work, 'data');
const framesDir = join(work, 'frames');
mkdirSync(framesDir);

const store = new Store(join(dataDir, 'lapse.db'));
seedDemo(store);
store.db.close();

const env: NodeJS.ProcessEnv = {
  ...process.env,
  PORT: String(PORT),
  LAPSE_DATA_DIR: dataDir,
  LAPSE_BASE_URL: BASE,
  LAPSE_AI_PROVIDER: 'none',
  // No scans or alerts while recording.
  LAPSE_SCHEDULER: 'off',
};
delete env.LAPSE_USER;
delete env.LAPSE_PASSWORD;
// Server errors (e.g. a crash on startup) show up in this script's output.
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

const frames: { file: string; seconds: number }[] = [];

async function frame(page: Page, caption: string, seconds: number): Promise<void> {
  await page.evaluate((text) => {
    document.getElementById('demo-caption')?.remove();
    const el = document.createElement('div');
    el.id = 'demo-caption';
    el.textContent = text;
    el.style.cssText =
      'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:#1d1d1b;color:#fff;' +
      'padding:12px 22px;border-radius:10px;font:600 17px system-ui,sans-serif;white-space:nowrap;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.28);z-index:9999';
    document.body.append(el);
  }, caption);
  const file = join(framesDir, `${String(frames.length).padStart(2, '0')}.png`);
  await page.screenshot({ path: file });
  frames.push({ file, seconds });
}

async function scrollTo(page: Page, selector: string, offset = 90): Promise<void> {
  await page.evaluate(
    (sel, off) => {
      const el = [...document.querySelectorAll('h2')].find((h) => h.textContent?.startsWith(sel));
      if (el) window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - off);
    },
    selector,
    offset,
  );
}

async function record(): Promise<void> {
  const executablePath = BROWSERS.find((p) => p && existsSync(p));
  if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH.');
  const browser = await puppeteer.launch({ executablePath, headless: true, defaultViewport: VIEWPORT });
  try {
    const page = await browser.newPage();
    await page.emulateMediaFeatures([{ name: 'prefers-color-scheme', value: 'light' }]);

    await page.goto(`${BASE}/`);
    await frame(page, 'Everything that expires, sorted by the day you actually need to act', 3.5);

    await scrollTo(page, 'Missed');
    await frame(page, 'Missed a cancel-by date? Lapse shows your next chance', 3);

    await page.goto(`${BASE}/items/new`);
    const input = await page.$('input[type=file]');
    await input!.uploadFile(resolve('examples/sample-subscription-en.pdf'));
    await frame(page, 'Upload a contract PDF…', 2);

    await Promise.all([page.waitForNavigation(), page.click('form[action="/items/import"] button')]);
    await frame(page, '…Lapse finds the terms and shows where in the contract it found each one', 4);

    await Promise.all([page.waitForNavigation(), page.click('form[action="/items"] button')]);
    await frame(page, '…and works out the last day to cancel', 3);

    await page.goto(`${BASE}/domains`);
    await frame(page, 'Enter a domain: Lapse finds every certificate by itself', 3);

    const items = (await (await fetch(`${BASE}/api/items`)).json()) as { id: number; name: string }[];
    const api = items.find((i) => i.name === 'api.acme.example');
    await page.goto(`${BASE}/items/${api!.id}`);
    await frame(page, 'It even notices when automatic certificate renewal has failed', 3.5);

    await page.goto(`${BASE}/channels`);
    await frame(page, 'Alerts go to Slack, email or your phone, and escalate if nobody reacts', 3.5);
  } finally {
    await browser.close();
  }
}

try {
  await waitForServer();
  await record();

  // ffmpeg concat: each frame with its duration (the last one listed twice, as concat requires).
  const list = frames.map((f) => `file '${f.file.replace(/\\/g, '/')}'\nduration ${f.seconds}`).join('\n');
  writeFileSync(join(work, 'frames.txt'), `${list}\nfile '${frames.at(-1)!.file.replace(/\\/g, '/')}'\n`);
  mkdirSync('docs', { recursive: true });
  execFileSync('ffmpeg', [
    '-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(work, 'frames.txt'),
    '-vf', 'fps=2,split[a][b];[a]palettegen=max_colors=128:stats_mode=full[p];[b][p]paletteuse=dither=none',
    '-loop', '0', OUT,
  ]);
  console.log(`Wrote ${OUT} (${frames.length} frames)`);
} finally {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill();
    await once(server, 'exit');
  }
  // Windows may still hold the database file for a moment; a leftover temp dir is harmless.
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
}
