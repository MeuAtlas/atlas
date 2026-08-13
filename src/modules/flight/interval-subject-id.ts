import { createHash } from "node:crypto";

function deterministicUuid(namespace: string, parts: Array<string | null>) {
  const digest = createHash("sha256").update(`${namespace}:${parts.map((part) => part ?? "<null>").join("|")}`).digest("hex");
  const bytes = `${digest.slice(0, 12)}5${digest.slice(13, 16)}${(Number.parseInt(digest[16], 16) & 0x3 | 0x8).toString(16)}${digest.slice(17, 32)}`;
  return `${bytes.slice(0, 8)}-${bytes.slice(8, 12)}-${bytes.slice(12, 16)}-${bytes.slice(16, 20)}-${bytes.slice(20, 32)}`;
}

export const groundIntervalSubjectId = (importId: string, dutyId: string, previousLegId: string, nextLegId: string, startAt: string, endAt: string) => deterministicUuid("ground_interval", [importId, dutyId, previousLegId, nextLegId, startAt, endAt]);
export const restIntervalSubjectId = (importId: string, previousDutyId: string | null, nextDutyId: string | null, startAt: string, endAt: string) => deterministicUuid("rest_interval", [importId, previousDutyId, nextDutyId, startAt, endAt]);
