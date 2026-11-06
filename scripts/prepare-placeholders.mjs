import { copyFile, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';

const placeholder = new URL('../public/cards/card-placeholder.png', import.meta.url);
const fixture = new URL('../e2e/card-fixture.png', import.meta.url);
const browser = await chromium.launch();

try {
  const page = await browser.newPage({ viewport: { width: 734, height: 1024 } });
  await page.setContent(`<!doctype html>
    <html lang="en">
      <meta charset="utf-8">
      <title>Neutral card placeholder</title>
      <style>
        * { box-sizing: border-box; }
        body { margin: 0; padding: 24px; background: #e5e9f0; }
        main {
          height: 976px;
          border: 4px solid #aeb9ca;
          border-radius: 20px;
          display: grid;
          place-content: center;
          justify-items: center;
          gap: 48px;
          background: repeating-linear-gradient(135deg, #f8fafc 0 24px, #eef2f6 24px 26px);
        }
        .symbol {
          width: 148px;
          height: 196px;
          border: 10px solid #697b96;
          border-radius: 12px;
          display: grid;
          place-items: center;
        }
        .symbol::after {
          content: '';
          width: 48px;
          height: 48px;
          border: 8px solid #697b96;
          transform: rotate(45deg);
        }
        .line { height: 10px; width: 180px; background: #aeb9ca; border-radius: 5px; }
        .line--short { width: 110px; }
      </style>
      <body><main aria-label="Neutral card placeholder">
        <div class="symbol"></div><div class="line"></div><div class="line line--short"></div>
      </main></body>
    </html>`);
  await mkdir(new URL('../public/cards/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(placeholder), type: 'png' });
  await copyFile(placeholder, fixture);
  await rm(new URL('../public/cards/pokemon-card-back.jpg', import.meta.url), { force: true });
} finally {
  await browser.close();
}
