import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requireFromMainCheckout = createRequire(
  "/home/claudedev/aeqi/package.json",
);
const { chromium } = requireFromMainCheckout("playwright");
const outDir = path.resolve(
  __dirname,
  "../../apps/ui/public/decks/aeqi-mvp-pitch",
);
const indexUrl = `file://${path.join(__dirname, "index.html")}`;

await mkdir(outDir, { recursive: true });

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await page.goto(indexUrl, { waitUntil: "networkidle" });
await page.evaluate(() => document.fonts?.ready);

const slides = await page.locator(".slide").all();
for (let i = 0; i < slides.length; i += 1) {
  const name = `slide-${String(i + 1).padStart(2, "0")}.png`;
  await slides[i].screenshot({ path: path.join(outDir, name) });
  console.log(`rendered ${name}`);
}

await browser.close();
