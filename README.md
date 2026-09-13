# Folio

**Read. Understand. Remember.**

A digital book that understands what you're reading. Upload a PDF or EPUB, read
it as a bound book with real page turns, select a passage and ask about it, hold
the spacebar and ask out loud, have the book read itself to you — and come back
tomorrow to the exact page, with every highlight, note and question still there.

---

## Running it

```bash
npm install
npm run dev
```

Open <http://localhost:3000>, create an account, and drag a PDF onto the library.

**It runs with no configuration at all.** With no keys present, Folio stores your
library in `./.data` and the companion panel explains that it has no AI key
rather than pretending to answer. Everything else — reading, flipping, zoom,
selection, highlights, notes, bookmarks, search, voice capture, narration with
sentence-by-sentence highlighting — is fully working.

To bring the companion to life, put one line in `.env.local`:

```bash
GEMINI_API_KEY=...
```

Restart, and the same panel streams real answers about the page you're on.

---

## Configuration

Copy `.env.example` to `.env.local`. Every variable is optional in development.

| Variable | What it does |
|---|---|
| `GEMINI_API_KEY` | Turns on the reading companion. Without it, a development-only provider streams a placeholder. |
| `FOLIO_AI_MODEL` | Defaults to `gemini-3.5-flash-lite`, chosen by benchmarking time-to-first-token — the number a voice question actually feels. `gemini-3.5-flash` and `gemini-3.6-flash` are more capable but start answering 2–5× slower. |
| `SUPABASE_URL`<br>`SUPABASE_SERVICE_ROLE_KEY` | Switches storage from local files to Postgres + object storage. **Required in production** — the app refuses to boot without them. No anon key: the browser never talks to Supabase directly. |
| `SESSION_SECRET` | Signs the session cookie. Required in production. `openssl rand -base64 48` |
| `TTS_PROVIDER`, `TTS_API_KEY`, `TTS_VOICE` | Optional cloud voice. Defaults to the browser's own synthesis, which is the only engine that reports sentence boundaries in real time — which is what the narration highlight needs. |

---

## Deploying

1. **Create a Supabase project**, open the SQL editor, and run
   [`supabase/schema.sql`](supabase/schema.sql). It creates every table, the
   indexes, row-level security, and the private `books` storage bucket.

2. **Deploy to Vercel** and set the environment variables above (plus `SESSION_SECRET`). `vercel.json`
   already gives the streaming route the 60 seconds it needs.

```bash
npx vercel --prod
```

Uploads go from the browser **straight to Supabase Storage** via a signed URL, so
a 40 MB book never has to fit through Vercel's 4.5 MB function body limit.

---

## How it works

### The book is the interface

The reader is a real spread: left page even, right page odd, page one alone on
the right the way a bound book opens. A turn is a fold — the leaf rotates on the
spine in 3D with its back face carrying the next page and the shadow deepening
as it passes vertical. Only transforms and opacity animate, so it runs on the
compositor and never reflows the page beneath.

Text selection always wins over the gesture. The leaf is inert while you are
selecting; turning happens through the margins, the arrows, or a swipe. With
`prefers-reduced-motion`, the fold becomes a cut.

Pages are rasterised once to `ImageBitmap`s and cached, and the neighbouring
spread is warmed while you read — a turn needs up to four pages on screen at
once and none of them can be waiting.

**EPUB is a different shape.** A reflowable book has no page geometry, so
epub.js paginates it inside an iframe. Live document content cannot be folded in
3D without rasterising it first, and rasterising would break selection — so per
the spec's own rule, selection wins and EPUB turns are a slide rather than a
fold. Everything above the renderer — position, highlights, notes, search, AI,
narration — is identical for both formats. EPUB highlights anchor to a CFI
instead of a character offset; that is the only difference in the data model.

### Selection, highlights and narration share one coordinate system

Every mark is stored as a character offset into the page's extracted text, not
as a pixel rectangle. A highlight made at 100% lands correctly at 250%, in two-page
mode, and on a phone. The narration cursor uses the same offsets, which is why
the sentence being spoken is exactly the sentence lit up on the page.

### Hold space, talk, release, send

Capture starts on `keydown`, never on `keyup` — waiting would clip the first
words. It stays out of the way while you're typing, under a modifier, and on
auto-repeat. One capture produces exactly one request: two paths race to finish
it (the recogniser's `onend` and a timeout for engines that never fire it) and a
latch makes the loser a no-op. Escape cancels; losing window focus closes the
microphone rather than leaving it open.

Ask something while the book is being read aloud and narration pauses where it
is. Say "continue" and it resumes from the same sentence.

### Context, not the whole book

The companion is given, strongest first: your selection, the current page,
nearby pages, passages retrieved from what you've already read, your own
highlights near this page, and the few prior turns that are actually relevant.
Never the whole book.

**Spoiler protection is a retrieval filter, not a request in the prompt.** Pages
past your position are not placed in the context window at all, so there is
nothing for the model to let slip. Ask explicitly — "how does it end?" — and the
horizon lifts.

Retrieval is BM25 over the book's own chunks. A book is a small closed corpus, so
this runs in about a millisecond with no embedding call, no vector store and no
extra key — and `Retriever` is an interface, so a dense retriever can replace it
without touching the context builder.

### Everything is behind a seam

`DataAdapter`, `AIProvider`, `Retriever`, `SpeechToTextService`,
`TextToSpeechService` — each has a shipped implementation and no caller that
knows which one is active. Supabase or local files, Gemini or the placeholder,
browser speech or a cloud voice: all configuration, no code change.

### Parsing happens in the browser

pdf.js is already in the page rendering the book, so it extracts the text too,
in a worker, and posts it up in batches. A 500-page book becomes answerable page
by page while you read the first one — rather than tying up a serverless
function for minutes. Page numbers ride along on every chunk, which is what lets
an answer cite "p. 84" and lets the citation navigate.

---

## Tests

```bash
npm test
```

54 tests covering the parts where a bug is invisible until it matters: spoiler
filtering, chunk-to-page integrity, retrieval ranking, sentence offsets,
password hashing, and all ten spacebar cases — including the duplicate-request
one, which caught a real double-submission bug.

`tests/extraction.test.ts` runs against a real PDF and asserts the offset
contract that every highlight depends on.

Unit tests can't see a canvas that never painted or a listener that fired twice,
so there is also a browser walkthrough of the whole journey:

```bash
npm run dev
npm run smoke -- ~/path/to/any-book.pdf     # the PDF path
npm run smoke:epub -- ~/path/to/book.epub   # the EPUB path
```

It signs up, uploads, parses, opens, turns, selects, highlights, asks, searches,
closes and reopens — and asserts the one thing that must never break: the book
comes back on the same page with every mark still on it. Between them they found seven bugs everything else passed: a stale cache between
module instances, a duplicate voice submission, a hydration mismatch in the theme
toggle, and — on the EPUB side — a reader that never branched on format, an
`openAs` omission that hung `ready` forever, text extraction reading `.body` off
an element that hasn't got one, and a teardown race that re-probed a destroyed
book.

---

## Shortcuts

| | |
|---|---|
| Hold `Space` | Ask out loud |
| `←` `→` | Turn the page |
| `⌘F` | Search inside the book |
| `B` | Bookmark |
| `N` | New note |
| `H` | Highlight the selection |
| `F` | Focus mode |
| `0` `+` `−` | Zoom |
| `Esc` | Close, or leave focus mode |
