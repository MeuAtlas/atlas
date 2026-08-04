import { normalizeInvoiceText } from "./normalize-text";
import type { PdfTextItem, PdfVisualLine } from "./types";

const byVisualOrder = (a: PdfTextItem, b: PdfTextItem) =>
  Math.abs(a.y - b.y) > 2.5 ? b.y - a.y : a.x - b.x;

export function mergeAdjacentTextItems(items: PdfTextItem[]) {
  const sorted = [...items].sort((a, b) => a.x - b.x);
  let text = "";
  let right = 0;
  for (const item of sorted) {
    const gap = item.x - right;
    const separator = text && gap > Math.max(1.5, item.height * .12) ? " " : "";
    text += `${separator}${item.text}`;
    right = Math.max(right, item.x + item.width);
  }
  return normalizeInvoiceText(text);
}

export function groupTextItemsIntoVisualLines(
  items: PdfTextItem[],
  input: { columnIndex?: number; yTolerance?: number } = {},
): PdfVisualLine[] {
  const yTolerance = input.yTolerance ?? 2.5;
  const groups: PdfTextItem[][] = [];
  for (const item of [...items].sort(byVisualOrder)) {
    const group = groups.find(candidate =>
      Math.abs((candidate.reduce((sum, value) => sum + value.y, 0) / candidate.length) - item.y)
        <= yTolerance,
    );
    if (group) group.push(item);
    else groups.push([item]);
  }
  return groups.map(group => ({
    pageNumber: group[0].pageNumber,
    columnIndex: input.columnIndex ?? 0,
    x: Math.min(...group.map(item => item.x)),
    y: group.reduce((sum, item) => sum + item.y, 0) / group.length,
    text: mergeAdjacentTextItems(group),
    items: [...group].sort((a, b) => a.x - b.x),
  })).filter(line => line.text).sort((a, b) => b.y - a.y || a.x - b.x);
}

export function splitPageIntoColumns(input: {
  items: PdfTextItem[];
  pageWidth: number;
  pageHeight: number;
}): PdfTextItem[][] {
  const midpoint = input.pageWidth / 2;
  const lowerTableItems = input.items.filter(item => item.y < input.pageHeight * .68);
  const left = lowerTableItems.filter(item => item.x + item.width < midpoint - 5).length;
  const right = lowerTableItems.filter(item => item.x > midpoint + 5).length;
  const leftItemsWithMarkers = input.items.filter(item =>
    item.x + item.width <= midpoint &&
    /VALOR TOTAL|X{2,}\s*\d{4}/i.test(item.text),
  );
  const rightItemsWithMarkers = input.items.filter(item =>
    item.x >= midpoint &&
    /VALOR TOTAL|RESUMO DA FATURA|X{2,}\s*\d{4}/i.test(item.text),
  );
  const hasSparseSummaryColumn =
    left >= 12 &&
    right >= 3 &&
    leftItemsWithMarkers.length > 0 &&
    rightItemsWithMarkers.length > 0;
  if ((left < 12 || right < 12) && !hasSparseSummaryColumn) return [input.items];

  const spanning = input.items.filter(item =>
    item.x < midpoint && item.x + item.width > midpoint,
  );
  const leftItems = input.items.filter(item =>
    item.x + item.width <= midpoint || item.x < midpoint && !spanning.includes(item),
  );
  const rightItems = input.items.filter(item =>
    item.x >= midpoint || item.x + item.width > midpoint && !spanning.includes(item),
  );
  return [leftItems, rightItems];
}

export function buildVisualLines(input: {
  items: PdfTextItem[];
  pageWidth: number;
  pageHeight: number;
}) {
  return splitPageIntoColumns(input).flatMap((items, columnIndex) =>
    groupTextItemsIntoVisualLines(items, { columnIndex }),
  );
}

export function isDecorativeTransactionGlyph(value: string) {
  const text = normalizeInvoiceText(value).trim();
  return /^[@23]$/.test(text) || /^[^\p{L}\p{N}]{1,2}$/u.test(text);
}
