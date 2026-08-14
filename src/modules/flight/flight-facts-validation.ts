import type { FactRecord } from "./flight-facts";

export function validateFactsForPersistence(facts: FactRecord[]) {
  const errors: string[] = [];
  const keys = new Set<string>();

  for (const fact of facts) {
    const scheduleChangeType = fact.factKey === "schedule_change" && typeof fact.value.changeType === "string"
      ? fact.value.changeType
      : null;

    // A duty can legitimately emit a structural change plus independent report
    // and release-time changes. The table's canonical subject uniqueness is one
    // fact per (key, subject), so child changes remain linked through their
    // planned/executed references in value rather than sharing the duty subject.
    if (scheduleChangeType === "REPORT_TIME_CHANGED" || scheduleChangeType === "RELEASE_TIME_CHANGED") {
      fact.subjectId = null;
    }

    const key = `${fact.factKey}:${fact.subjectType}:${fact.subjectId ?? JSON.stringify(fact.value)}${scheduleChangeType ? `:${scheduleChangeType}` : ""}`;

    if (keys.has(key)) errors.push(`Fato duplicado: ${key}`);
    keys.add(key);

    if (typeof fact.value.durationMinutes === "number" && fact.value.durationMinutes < 0) {
      errors.push(`DuraÃ§Ã£o negativa em ${fact.factKey}.`);
    }
  }

  return { valid: errors.length === 0, errors };
}
