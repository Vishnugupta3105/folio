/**
 * Browser walkthrough for the EPUB path.
 *
 * A reflowable book renders through epub.js in an iframe rather than onto a
 * canvas, so none of the PDF smoke test's selectors apply and it needs its own
 * run. This caught four separate bugs the unit tests could not see.
 *
 *   npm run smoke:epub -- path/to/book.epub [http://localhost:3000]
 */
import { chromium } from "playwright";
const EPUB = process.argv[2];
const B = process.argv[3] ?? "http://localhost:3000";
if (!EPUB) { console.error("usage: npm run smoke:epub -- <path-to-epub> [base-url]"); process.exit(1); }
const check = (n,p,d="") => console.log(`${p?"✓":"✗"} ${n}${d?` — ${d}`:""}`);
const browser = await chromium.launch();
setTimeout(() => { console.log("!! hard timeout"); process.exit(2); }, 110_000);
const page = await (await browser.newContext({viewport:{width:1440,height:900}})).newPage();
page.setDefaultTimeout(8000);
const errors = [];
page.on("pageerror", e=>errors.push(e.message.slice(0,160)));
page.on("console", m=>{ if(m.type()==="error") errors.push(m.text().slice(0,160)); });

await page.goto(`${B}/signup`);
  await page.fill('input[name="name"]', "Smoke Reader");
  await page.fill('input[name="email"]', `smoke${Date.now()}@folio.test`);
  await page.fill('input[name="password"]', "smoke-test-password");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/library", { timeout: 20_000 });
await page.setInputFiles("#folio-upload", EPUB);
await page.waitForFunction(()=>!document.body.innerText.includes("PREPARING")&&document.querySelectorAll("article").length>0,{timeout:60000});
await page.click("article a");
await page.waitForURL("**/reader/**");
await page.waitForTimeout(6000);
const url = page.url();
const pn = () => page.locator('input[aria-label*="Page"]').getAttribute("placeholder");

// Selection inside the iframe: double-click selects a word, which is what a
// reader does on touch and what fires epub.js's selection event.
const frame = page.frames().find(f=>f!==page.mainFrame());
check("iframe present", !!frame);
if (frame) {
  await frame.locator("p").first().dblclick({timeout:6000}).catch(e=>console.log("  dblclick:",String(e).slice(0,80)));
  await page.waitForTimeout(1500);
}
let tb = await page.locator('[role="toolbar"]').isVisible().catch(()=>false);

if (!tb && frame) {
  // Fall back to a drag across the paragraph.
  const bb = await frame.locator("p").first().boundingBox().catch(()=>null);
  if (bb) {
    await page.mouse.move(bb.x+12, bb.y+10); await page.mouse.down();
    await page.mouse.move(bb.x+260, bb.y+10, {steps:16}); await page.mouse.up();
    await page.waitForTimeout(1500);
    tb = await page.locator('[role="toolbar"]').isVisible().catch(()=>false);
  }
}
check("selecting EPUB text offers actions", tb);
await page.screenshot({path:"/tmp/shots/24-epub-selection.png"});

if (tb) {
  await page.click('[aria-label="Highlight"]',{timeout:5000}); await page.waitForTimeout(300);
  await page.click('[aria-label="Highlight Amber"]',{timeout:5000}); await page.waitForTimeout(1800);
  await page.screenshot({path:"/tmp/shots/25-epub-highlight.png"});
  // epub.js paints marks into a pane in the MAIN document, over the iframe.
  const painted = await page.evaluate(()=>document.querySelectorAll(".epubjs-hl").length);
  check("highlight painted in the book", painted > 0, `${painted} svg marks`);
  await page.click('[aria-label="Notes and highlights"]',{timeout:5000}).catch(()=>{});
  await page.waitForTimeout(900);
  const np = await page.locator('aside[aria-label*="Notes"]').innerText().catch(()=>"");
  check("EPUB highlight saved", np.includes("HIGHLIGHT"), np.slice(0,60).replace(/\n/g," | "));
  await page.keyboard.press("Escape"); await page.waitForTimeout(400);
}

await page.click('button[title="AI companion"]',{timeout:5000}); await page.waitForTimeout(500);
await page.fill('textarea[placeholder*="Ask about"]',"What is this about?");
await page.keyboard.press("Enter"); await page.waitForTimeout(4000);
check("companion answers for EPUB",(await page.locator('aside[aria-label="AI companion"]').innerText()).length>150);
await page.keyboard.press("Escape"); await page.waitForTimeout(400);

await page.click('button[aria-label="Read aloud"]',{timeout:5000}); await page.waitForTimeout(2500);
const nar = await page.locator('[aria-label="Narration"]').innerText().catch(()=>"");
check("EPUB narration starts", /Reading aloud|Ready to read|Paused/.test(nar), nar.split("\n")[0]);
await page.click('button[aria-label="Stop narration"]',{timeout:5000}).catch(()=>{});
await page.waitForTimeout(500);

const left = await pn();
await page.goto(`${B}/library`); await page.waitForTimeout(1200);
await page.goto(url); await page.waitForTimeout(6500);
check("EPUB reopens on the same page", await pn() === left, `${left} -> ${await pn()}`);
const restored = await page.evaluate(()=>document.querySelectorAll(".epubjs-hl").length);
check("EPUB highlight restored on reopen", restored > 0, `${restored} marks`);

await browser.close();
console.log("\nerrors:", errors.length ? [...new Set(errors)].slice(0,6).join("\n") : "none");
process.exit(0);
