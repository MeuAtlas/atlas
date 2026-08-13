import type { ExtractedPdfDocument, PdfTextItem } from "@/modules/finance/invoice-import/types";

export const NETLINE_PARSER_VERSION = "netline-gol-parser/0.1.0";
export type ParserSeverity = "info" | "warning" | "error";
export type ParserWarning = { code: string; severity: ParserSeverity; message: string };
export type ParsedScheduleDay = { scheduleDate: string; dayNumber: number; weekday: number; rawText: string };
export type UnknownScheduleText = { pageNumber: number | null; rawValue: string; rawLine: string; parserStage: "HEADER" | "DAY_SEGMENTATION" | "DOCUMENT_STRUCTURE"; reason: string };
export type NetlineParseResult = { documentType: "NETLINE_GOL" | null; confidence: number; crewId: string | null; crewName: string | null; homeBase: string | null; periodStart: string | null; periodEnd: string | null; generatedAt: string | null; days: ParsedScheduleDay[]; unknown: UnknownScheduleText[]; warnings: ParserWarning[] };
export type SpatialLine = { y: number; text: string; items: PdfTextItem[] };

const monthNumbers: Record<string, number> = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };
const weekdayTokens = "Mon|Tue|Wed|Thu|Fri|Sat|Sun";
const dateToken = "(\\d{1,2})\\s*(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\\s*(\\d{2,4})";
function isoDate(day: string, month: string, year: string) { const fullYear = year.length === 2 ? 2000 + Number(year) : Number(year); const value = new Date(Date.UTC(fullYear, monthNumbers[month.toLowerCase()], Number(day))); return Number.isNaN(value.valueOf()) ? null : value.toISOString().slice(0, 10); }
export function parseNetlineDate(value: string) { const match = value.trim().match(new RegExp(`^${dateToken}$`, "i")); return match ? isoDate(match[1], match[2], match[3]) : null; }
function headerValue(text: string, expressions: RegExp[]) { for (const expression of expressions) { const match = text.match(expression); if (match?.[1]?.trim()) return match[1].trim().replace(/\s+/g, " "); } return null; }
function periodDays(start: string, end: string) { const values: ParsedScheduleDay[] = []; for (let cursor = new Date(`${start}T00:00:00Z`), final = new Date(`${end}T00:00:00Z`); cursor <= final; cursor.setUTCDate(cursor.getUTCDate()+1)) values.push({ scheduleDate: cursor.toISOString().slice(0,10), dayNumber: cursor.getUTCDate(), weekday: cursor.getUTCDay(), rawText: "" }); return values; }

export function reconstructSpatialLines(items: PdfTextItem[], yTolerance = 3): SpatialLine[] {
  const lines: Array<{ y: number; items: PdfTextItem[] }> = [];
  for (const item of [...items].filter(value => value.text.trim()).sort((a, b) => b.y - a.y || a.x - b.x || a.visualIndex - b.visualIndex)) {
    const line = lines.find(candidate => Math.abs(candidate.y - item.y) <= yTolerance);
    if (line) { line.items.push(item); line.y = (line.y * (line.items.length - 1) + item.y) / line.items.length; }
    else lines.push({ y: item.y, items: [item] });
  }
  return lines.sort((a, b) => b.y - a.y).map(line => ({ y: line.y, items: line.items.sort((a, b) => a.x - b.x || a.visualIndex - b.visualIndex), text: line.items.sort((a, b) => a.x - b.x || a.visualIndex - b.visualIndex).map(item => item.text).join(" ").replace(/\s+/g, " ").trim() }));
}

function headerLines(document: ExtractedPdfDocument) {
  const firstPage = document.pages[0];
  if (!firstPage) return [];
  const lines = reconstructSpatialLines(firstPage.items);
  const highestY = Math.max(...lines.map(line => line.y));
  const threshold = highestY - Math.max(180, firstPage.height * .55);
  return lines.filter(line => line.y >= threshold);
}

function parseCrewFromHeader(lines: SpatialLine[]) {
  const signedBlock = lines.map(line => line.text).join("\n").match(/Individual\s+duty\s+plan\s+for\s+(\d{6,10})\s+([\s\S]*?)\s+NetLine\/Crew\s*\(\s*GOL\s*\)/i);
  if (signedBlock) {
    const name = signedBlock[2].replace(/\s+/g, " ").trim();
    if (name) return { id: signedBlock[1], name, confidence: .99 };
  }
  const numericId = /\b(\d{6,10})\b/;
  for (let index = 0; index < lines.length; index += 1) {
    const idMatch = lines[index].text.match(numericId);
    if (!idMatch) continue;
    const nearby = lines.slice(Math.max(0, index - 2), index + 3).map(line => line.text).join(" ");
    const nameTokens = nearby.replace(numericId, " ").match(/\b[A-ZÀ-Ú]{2,}\b/g) ?? [];
    const filtered = nameTokens.filter(token => !["NETLINE", "GOL", "ROSTER", "BASE", "CREW", "DATE"].includes(token));
    const nameWords = filtered.filter(token => token.length >= 4);
    if (nameWords.length >= 2) return { id: idMatch[1], name: filtered.filter(token => token.length >= 4 || ["DE", "DA", "DO", "DOS", "DAS"].includes(token)).join(" "), confidence: .95 };
  }
  return { id: null, name: null, confidence: 0 };
}

function spatialScheduleText(document: ExtractedPdfDocument, days: ParsedScheduleDay[]) {
  const byDay = new Map(days.map(day => [day.dayNumber, day]));
  let assigned = 0;

  for (const page of document.pages) {
    const lanes = [
      page.items.filter(item => item.x < 266),
      page.items.filter(item => item.x >= 266 && item.x < 533),
      page.items.filter(item => item.x >= 533),
    ];

    for (const lane of lanes) {
      let active: ParsedScheduleDay | null = null;
      const lines = reconstructSpatialLines(lane).reverse();
      for (const line of lines) {
        const compactMarker = line.text.match(new RegExp(`\\b(?:${weekdayTokens})\\s*(\\d{1,2})\\b`, "i"));
        if (compactMarker) active = byDay.get(Number(compactMarker[1])) ?? null;
        if (!active) continue;
        active.rawText += `${line.text}\n`;
        assigned += 1;
      }
    }
  }
  return assigned;
}

export function parseNetlineDocument(document: ExtractedPdfDocument): NetlineParseResult {
  const rawText = document.pages.map(page => page.plainText || page.text).join("\n");
  const signatureHits = ["NETLINE", "GOL", "ROSTER", "CREW"].filter(marker => rawText.toUpperCase().includes(marker)).length;
  const warnings: ParserWarning[] = [];
  const isNetline = signatureHits >= 2 || (/NETLINE/i.test(rawText) && /(?:SCALE|ROSTER|CREW|GOL)/i.test(rawText));
  if (!isNetline) warnings.push({ code: "DOCUMENT_NOT_RECOGNIZED", severity: "warning", message: "Documento não reconhecido como escala NetLine compatível." });
  const periodMatch = rawText.match(new RegExp(`${dateToken}\\s*(?:-|–|to)\\s*${dateToken}`, "i"));
  const periodStart = periodMatch ? isoDate(periodMatch[1], periodMatch[2], periodMatch[3]) : null;
  const periodEnd = periodMatch ? isoDate(periodMatch[4], periodMatch[5], periodMatch[6]) : null;
  if (!periodStart || !periodEnd) warnings.push({ code: "MISSING_PERIOD", severity: "warning", message: "Período da escala não encontrado." });
  const header = headerLines(document);
  const spatialCrew = parseCrewFromHeader(header);
  const signedCrew = spatialCrew.id ? spatialCrew : parseCrewFromHeader(document.pages[0] ? reconstructSpatialLines(document.pages[0].items) : []);
  const crewId = signedCrew.id ?? headerValue(rawText, [/(?:Crew\s*(?:ID|No|Number)|Emp(?:loyee)?\s*(?:ID|No))\s*[:#-]?\s*([A-Z0-9-]{3,})/i, /(?:Mat(?:r[ií]cula)?|Registration)\s*[:#-]?\s*([A-Z0-9-]{3,})/i]);
  const crewNameCandidate = headerValue(rawText, [/(?:Crew\s*Name|Name|Tripulante)\s*[:#-]?\s*([A-ZÀ-Ú][A-ZÀ-Ú '\-]{2,})/i]);
  const crewName = signedCrew.name ?? (crewNameCandidate && !/(?:SIM|EMERGEN|ERGON|XQ)/i.test(crewNameCandidate) ? crewNameCandidate : null);
  const homeBase = headerValue(rawText, [/(?:Home\s*Base|Base)\s*[:#-]?\s*([A-Z]{3})\b/i]) ?? (/(?:^|\s)BSB(?:\s|$)/m.test(rawText) ? "BSB" : null);
  if (!crewId && !crewName) warnings.push({ code: "MISSING_CREW", severity: "warning", message: "Tripulante não encontrado no cabeçalho." });
  if (!homeBase) warnings.push({ code: "MISSING_BASE", severity: "warning", message: "Base não encontrada no cabeçalho." });
  const generated = headerValue(rawText, [/(?:Generated|Printed|Gerado(?:\s+em)?|Impresso(?:\s+em)?)\s*[:#-]?\s*(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}(?:\s+\d{1,2}:\d{2})?)/i]);
  const generatedAt = generated ? (() => { const m = generated.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})(?:\s+(\d{1,2}):(\d{2}))?/); if (!m) return null; const y=m[3].length===2?2000+Number(m[3]):Number(m[3]); return new Date(Date.UTC(y,Number(m[2])-1,Number(m[1]),Number(m[4]??0),Number(m[5]??0))).toISOString(); })() : null;
  const days = periodStart && periodEnd ? periodDays(periodStart, periodEnd) : [];
  const unknown: UnknownScheduleText[] = [];
  const spatialAssignments = spatialScheduleText(document, days);
  if (!spatialAssignments) {
    const dayMarkers = new RegExp(`\\b${dateToken}\\b`, "i");
    for (const page of document.pages) {
      let active: ParsedScheduleDay | null = null;
      const lines = (page.plainText || page.text).split(/\r?\n/);
      for (const line of lines) { const marker = line.match(dayMarkers); const date = marker ? parseNetlineDate(marker[0]) : null; const isPeriodLine = Boolean(periodMatch && line.includes(periodMatch[0])); if (date && !isPeriodLine) active = days.find(day => day.scheduleDate === date) ?? null; if (active && !isPeriodLine) active.rawText += `${line}\n`; else if (line.trim()) unknown.push({ pageNumber: page.pageNumber, rawValue: line, rawLine: line, parserStage: "DAY_SEGMENTATION", reason: "UNASSIGNED_TEXT" }); }
    }
  }
  if (unknown.length) warnings.push({ code: "UNASSIGNED_TEXT", severity: "info", message: `${unknown.length} linha(s) preservada(s) sem associação segura a um dia.` });
  for (const day of days) if (!day.rawText.trim()) warnings.push({ code: "MISSING_DAY", severity: "info", message: `Nenhum texto associado com segurança ao dia ${day.scheduleDate}.` });
  return { documentType: isNetline ? "NETLINE_GOL" : null, confidence: Math.max(Math.min(1, signatureHits / 3), signedCrew.confidence), crewId, crewName, homeBase, periodStart, periodEnd, generatedAt, days, unknown, warnings };
}
