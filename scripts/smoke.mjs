/**
 * End-to-end smoke test in a real browser.
 *
 *   npm run smoke -- path/to/any-book.pdf [http://localhost:3000]
 *
 * Walks the whole journey a reader actually takes — sign up, upload, parse,
 * open, turn, select, highlight, ask, search, close, reopen — and asserts the
 * one thing that must never break: the book reopens on the same page with every
 * mark still on it.
 *
 * Unit tests can't see a canvas that never painted or a listener that fired
 * twice. This found a stale-cache bug, a duplicate voice submission and a
 * hydration mismatch that all passed everything else.
 */
import { chromium } from "playwright";

const pdf = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3000";

if (!pdf) {
  console.error("usage: npm run smoke -- <path-to-pdf> [base-url]");
  process.exit(1);
}

const checks = [];
const check = (name, pass, detail = "") => {
  checks.push({ name, pass });
  console.log(`${pass ? "✓" : "✗"} ${name}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await context.newPage();

const errors = [];
page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(`console: ${m.text().slice(0, 160)}`);
});

const pageNumber = () =>
  page.locator('input[aria-label*="Page"]').getAttribute("placeholder");

try {
  await page.goto(`${base}/signup`);
  await page.fill('input[name="name"]', "Smoke Reader");
  await page.fill('input[name="email"]', `smoke${Date.now()}@folio.test`);
  await page.fill('input[name="password"]', "smoke-test-password");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/library", { timeout: 20_000 });
  check("sign up lands in the library", true);

  await page.setInputFiles("#folio-upload", pdf);
  await page.waitForFunction(
    () =>
      !document.body.innerText.includes("PREPARING") &&
      document.querySelectorAll("article").length > 0,
    { timeout: 180_000 },
  );
  check("upload parses in the browser and reaches the shelf", true,
    await page.locator("article h3").first().innerText());
  check("a cover was rendered from page one", (await page.locator("article img").count()) > 0);

  await page.click("article a");
  await page.waitForURL("**/reader/**", { timeout: 20_000 });
  await page.waitForTimeout(3500);
  check("the book renders", (await page.locator("main canvas").count()) > 0);

  const runs = await page.locator(".text-layer span").count();
  check("text is selectable", runs > 0, `${runs} runs`);

  const start = await pageNumber();
  await page.keyboard.press("ArrowRight");
  await page.waitForTimeout(1100);
  const turned = await pageNumber();
  check("the page turns", turned !== start, `${start} → ${turned}`);

  const span = page.locator(".text-layer span").nth(4);
  const box = await span.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 12 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }
  const toolbar = page.locator('[role="toolbar"]');
  const gotToolbar = await toolbar.isVisible().catch(() => false);
  check("selecting text offers actions", gotToolbar);

  if (gotToolbar) {
    await page.click('[aria-label="Highlight"]');
    await page.waitForTimeout(250);
    await page.click('[aria-label="Highlight Amber"]');
    await page.waitForTimeout(900);
    const marks = await page.evaluate(
      () => document.querySelectorAll('div[style*="mix-blend-mode: multiply"]').length,
    );
    check("the highlight is painted on the page", marks > 0);
  }

  await page.click('button[title="AI companion"]');
  await page.waitForTimeout(500);
  await page.fill('textarea[placeholder*="Ask about"]', "What is this page about?");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(4500);
  const answer = await page.locator('aside[aria-label="AI companion"]').innerText();
  check("the companion answers", answer.length > 120);
  check("the answer cites pages", /Based on|p\. ?\d/.test(answer));

  await page.keyboard.press("Escape");
  await page.waitForTimeout(400);
  await page.keyboard.press("Meta+f");
  await page.waitForTimeout(400);
  // A stopword, deliberately: ranked retrieval drops it, so this also proves
  // the literal fallback that makes search behave like Cmd+F.
  await page.fill('input[placeholder*="Find a word"]', "the");
  await page.waitForTimeout(1500);
  const hits = await page.locator('aside[aria-label*="Search"] li').count();
  check("search finds passages", hits > 0, `${hits} results`);
  await page.keyboard.press("Escape");

  // The non-negotiable one.
  const url = page.url();
  const left = await pageNumber();
  await page.goto(`${base}/library`);
  await page.waitForTimeout(1200);
  await page.goto(url);
  await page.waitForTimeout(3500);
  const reopened = await pageNumber();
  check("reopens on the exact page", reopened === left, `left on ${left}, opened on ${reopened}`);

  const restored = await page.evaluate(
    () => document.querySelectorAll('div[style*="mix-blend-mode: multiply"]').length,
  );
  check("highlights survive the reopen", restored > 0);

  check("no runtime errors", errors.length === 0, errors.slice(0, 3).join(" / "));
} finally {
  await browser.close();
}

const failed = checks.filter((c) => !c.pass);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
