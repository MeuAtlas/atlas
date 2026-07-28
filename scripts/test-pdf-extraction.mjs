import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

const inputPath = resolve(
  process.argv[2] ?? "scripts/fixtures/anonymous-invoice.pdf",
);
const raw = await readFile(inputPath);
const bytes = new Uint8Array(
  raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength),
);
const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
const loadingTask = pdfjs.getDocument({
  data: bytes,
  useSystemFonts: true,
});
const pdf = await loadingTask.promise;
const pages = [];

for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
  const page = await pdf.getPage(pageNumber);
  const content = await page.getTextContent();
  const strings = content.items
    .filter(item => typeof item === "object" && item && "str" in item)
    .map(item => String(item.str));
  pages.push({
    pageNumber,
    itemCount: content.items.length,
    characterCount: strings.join(" ").length,
  });
}

const result = {
  node: process.version,
  importPath: "pdfjs-dist/legacy/build/pdf.mjs",
  inputPath,
  pageCount: pdf.numPages,
  pages,
  itemCount: pages.reduce((total, page) => total + page.itemCount, 0),
  characterCount: pages.reduce(
    (total, page) => total + page.characterCount,
    0,
  ),
};

console.log(JSON.stringify(result, null, 2));
