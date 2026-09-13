// Copies the pdf.js worker, character maps and standard fonts into /public.
//
// These must match the installed pdfjs-dist exactly — a mismatched worker fails
// to initialise, and missing cmaps render CJK documents as blank boxes. Pulling
// them from a CDN would pin a version this project doesn't actually ship.
import { cp, mkdir } from "node:fs/promises";

const from = "node_modules/pdfjs-dist";
await mkdir("public/pdfjs", { recursive: true });
await cp(`${from}/build/pdf.worker.min.mjs`, "public/pdf.worker.min.mjs");
await cp(`${from}/cmaps`, "public/pdfjs/cmaps", { recursive: true });
await cp(`${from}/standard_fonts`, "public/pdfjs/standard_fonts", { recursive: true });
console.log("pdf.js assets copied to /public");
