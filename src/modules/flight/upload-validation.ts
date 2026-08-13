import type { FlightScheduleRole } from "./types";

export const FLIGHT_SCHEDULE_MAX_FILE_SIZE = 20 * 1024 * 1024;

export type UploadableFlightScheduleRole = Extract<
  FlightScheduleRole,
  "PLANNED" | "EXECUTION_SNAPSHOT"
>;

export function validateFlightPdf(input: {
  filename: string;
  mimeType: string;
  size: number;
  bytes: Uint8Array;
}) {
  if (input.mimeType !== "application/pdf" || !input.filename.toLowerCase().endsWith(".pdf")) {
    return "Envie apenas arquivos PDF.";
  }
  if (!input.size || input.size > FLIGHT_SCHEDULE_MAX_FILE_SIZE) {
    return "O PDF deve ter até 20 MB.";
  }
  if (Buffer.from(input.bytes.subarray(0, 5)).toString("ascii") !== "%PDF-") {
    return "O arquivo enviado não é um PDF válido.";
  }
  return null;
}

export function flightScheduleStoragePath(input: {
  userId: string;
  year: number;
  month: number;
  role: UploadableFlightScheduleRole;
  fileId: string;
}) {
  const folder = input.role === "PLANNED" ? "planned" : "execution";
  return `${input.userId}/${input.year}/${String(input.month).padStart(2, "0")}/${folder}/${input.fileId}.pdf`;
}
