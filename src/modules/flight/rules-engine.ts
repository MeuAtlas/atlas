export const FLIGHT_RULES_ENGINE_VERSION = "flight-rules-engine/1.0.0";
export type EvaluationStatus = "PASS" | "FAIL" | "UNKNOWN" | "NOT_APPLICABLE";
export type RuleEvaluation = { ruleKey: string; status: EvaluationStatus; limit: string; fact: number | null; explanation: string; evaluationContext?: "NORMAL" | "TRIGGER" | "EXCEPTION" };
export type StandbyMonthlyContext = { id: string; voluntaryTradeContext: unknown; origin: unknown };
export type NightEarlyDuty = { isNightOperation: unknown; isEarlyStart: unknown };

function duration(ruleKey: string, value: number | null, min: number, max: number): RuleEvaluation {
  if (value === null) return { ruleKey, status: "UNKNOWN", limit: `${min}-${max} min`, fact: null, explanation: "Duração factual indisponível." };
  return { ruleKey, status: value >= min && value <= max ? "PASS" : "FAIL", limit: `${min}-${max} min`, fact: value, explanation: `Duração factual: ${value} min; limite configurado: ${min}-${max} min.` };
}

function isKnownNonVoluntary(value: unknown) {
  return value === false || value === "FALSE" || value === "NO";
}

function hasKnownOrigin(value: unknown) {
  return typeof value === "string" && value !== "" && value !== "UNKNOWN";
}

export const evaluateStandbyDuration = (minutes: number | null) => duration("GOL_STANDBY_DURATION", minutes, 180, 720);
export const evaluateReserveDuration = (minutes: number | null) => duration("GOL_RESERVE_DURATION", minutes, 180, 360);

export function evaluateGroundTime(scheduleState: "PLANNED" | "EXECUTION_SNAPSHOT" | "FINAL_EXECUTED", minutes: number | null, classification: "DAY" | "NIGHT" | null): RuleEvaluation {
  if (scheduleState !== "PLANNED") return { ruleKey: "GOL_GROUND_TIME_BETWEEN_LEGS", status: "NOT_APPLICABLE", limit: "planned only", fact: minutes, explanation: "A regra é aplicável somente à escala planejada." };
  if (minutes === null || classification === null) return { ruleKey: "GOL_GROUND_TIME_BETWEEN_LEGS", status: "UNKNOWN", limit: "DAY 180 / NIGHT 120 min", fact: minutes, explanation: "Fato de intervalo ou classificação indisponível." };
  const max = classification === "DAY" ? 180 : 120;
  return { ruleKey: "GOL_GROUND_TIME_BETWEEN_LEGS", status: minutes <= max ? "PASS" : "FAIL", limit: `${classification} ${max} min`, fact: minutes, explanation: `Intervalo factual: ${minutes} min; classificação factual: ${classification}; limite configurado: ${max} min.` };
}

export function evaluateStandbyMonthlyLimit(standbys: StandbyMonthlyContext[], withinEffectivePeriod: boolean): RuleEvaluation {
  const count = standbys.length;
  if (!withinEffectivePeriod) return { ruleKey: "GOL_STANDBY_MONTHLY_LIMIT", status: "NOT_APPLICABLE", limit: "8 por mês", fact: count, explanation: "Instrumento não vigente para o período documental." };
  if (count <= 8) return { ruleKey: "GOL_STANDBY_MONTHLY_LIMIT", status: "PASS", limit: "8 por mês", fact: count, explanation: `Sobreavisos documentados no mês: ${count}; limite configurado: 8.` };
  const hasUnknownContext = standbys.some((standby) => !isKnownNonVoluntary(standby.voluntaryTradeContext) || !hasKnownOrigin(standby.origin));
  if (hasUnknownContext) return { ruleKey: "GOL_STANDBY_MONTHLY_LIMIT", status: "UNKNOWN", limit: "8 por mês", fact: count, explanation: `Sobreavisos documentados no mês: ${count}; voluntariedade ou origem de excedentes não está documentalmente confirmada.` };
  return { ruleKey: "GOL_STANDBY_MONTHLY_LIMIT", status: "FAIL", limit: "8 por mês", fact: count, explanation: `Sobreavisos documentados no mês: ${count}; limite configurado: 8, sem contexto voluntário aplicável confirmado.` };
}

export function evaluateStandbyUncalledRest(called: unknown, standbyEnd: string | null, nextActivityStart: string | null): RuleEvaluation {
  if (called === true || called === "TRUE") return { ruleKey: "GOL_STANDBY_UNCALLED_REST", status: "NOT_APPLICABLE", limit: "12 h", fact: null, explanation: "Sobreaviso documentado como convocado; a regra de repouso não convocado não se aplica." };
  if (!(called === false || called === "FALSE")) return { ruleKey: "GOL_STANDBY_UNCALLED_REST", status: "UNKNOWN", limit: "12 h", fact: null, explanation: "Convocação do sobreaviso não está documentalmente confirmada." };
  if (!standbyEnd || !nextActivityStart) return { ruleKey: "GOL_STANDBY_UNCALLED_REST", status: "UNKNOWN", limit: "12 h", fact: null, explanation: "Fim do sobreaviso ou início da próxima atividade indisponível." };
  const restMinutes = Math.round((Date.parse(nextActivityStart) - Date.parse(standbyEnd)) / 60000);
  if (!Number.isFinite(restMinutes) || restMinutes < 0) return { ruleKey: "GOL_STANDBY_UNCALLED_REST", status: "UNKNOWN", limit: "12 h", fact: null, explanation: "Intervalo documental de repouso indisponível." };
  return { ruleKey: "GOL_STANDBY_UNCALLED_REST", status: restMinutes >= 720 ? "PASS" : "FAIL", limit: "12 h", fact: restMinutes, explanation: `Repouso factual após sobreaviso não convocado: ${restMinutes} min; mínimo configurado: 720 min.` };
}

export function evaluateReserveAccommodationTrigger(minutes: number | null, withinEffectivePeriod: boolean): RuleEvaluation {
  if (!withinEffectivePeriod) return { ruleKey: "GOL_RESERVE_ACCOMMODATION_TRIGGER", status: "NOT_APPLICABLE", limit: "> 180 min", fact: minutes, explanation: "Instrumento não vigente para o período documental.", evaluationContext: "TRIGGER" };
  if (minutes === null) return { ruleKey: "GOL_RESERVE_ACCOMMODATION_TRIGGER", status: "UNKNOWN", limit: "> 180 min", fact: null, explanation: "Duração documental da reserva indisponível; requirement_triggered = UNKNOWN; accommodation_provided = UNKNOWN.", evaluationContext: "TRIGGER" };
  if (minutes <= 180) return { ruleKey: "GOL_RESERVE_ACCOMMODATION_TRIGGER", status: "NOT_APPLICABLE", limit: "> 180 min", fact: minutes, explanation: "requirement_triggered = false; accommodation_provided = UNKNOWN.", evaluationContext: "TRIGGER" };
  return { ruleKey: "GOL_RESERVE_ACCOMMODATION_TRIGGER", status: "PASS", limit: "> 180 min", fact: minutes, explanation: "requirement_triggered = true; accommodation_provided = UNKNOWN.", evaluationContext: "TRIGGER" };
}

export function evaluateNightOperationClassification(value: unknown): RuleEvaluation {
  if (value === true) return { ruleKey: "GOL_NIGHT_OPERATION_CLASSIFICATION", status: "PASS", limit: "00:00-06:00", fact: null, explanation: "Classificação factual de madrugada confirmada." };
  if (value === false) return { ruleKey: "GOL_NIGHT_OPERATION_CLASSIFICATION", status: "NOT_APPLICABLE", limit: "00:00-06:00", fact: null, explanation: "A duty não possui classificação factual de madrugada." };
  return { ruleKey: "GOL_NIGHT_OPERATION_CLASSIFICATION", status: "UNKNOWN", limit: "00:00-06:00", fact: null, explanation: "Classificação factual de madrugada indisponível." };
}

export function evaluateEarlyStartClassification(value: unknown): RuleEvaluation {
  if (value === true) return { ruleKey: "GOL_EARLY_START_CLASSIFICATION", status: "PASS", limit: "05:00-07:00", fact: null, explanation: "Classificação factual de Early Start confirmada. Atlas classifies Early Start from duty presentation within 05:00–07:00, based on the reviewed interpretation of the ACT wording." };
  if (value === false) return { ruleKey: "GOL_EARLY_START_CLASSIFICATION", status: "NOT_APPLICABLE", limit: "05:00-07:00", fact: null, explanation: "A duty não possui classificação factual de Early Start." };
  return { ruleKey: "GOL_EARLY_START_CLASSIFICATION", status: "UNKNOWN", limit: "05:00-07:00", fact: null, explanation: "Classificação factual de Early Start indisponível." };
}

export function isNightOrEarlyOccurrence(duty: NightEarlyDuty): boolean | null {
  if (duty.isNightOperation === true || duty.isEarlyStart === true) return true;
  if (duty.isNightOperation === false && duty.isEarlyStart === false) return false;
  return null;
}

export function consecutiveNightEarlyOccurrences(occurrences: Array<boolean | null>): number | null {
  let current = 0;
  let maximum = 0;
  for (const occurrence of occurrences) {
    if (occurrence === null) return null;
    if (occurrence) { current += 1; maximum = Math.max(maximum, current); } else current = 0;
  }
  return maximum;
}

export function evaluateThirdConsecutiveNightException(thirdConsecutiveOccurrence: boolean, facts: { extraService: unknown; returnToContractualBase: unknown; endsDuty: unknown; noOperatingCrewBeforeThirdOccurrenceInSameDuty: unknown }): RuleEvaluation {
  if (!thirdConsecutiveOccurrence) return { ruleKey: "GOL_THIRD_CONSECUTIVE_NIGHT_EXCEPTION", status: "NOT_APPLICABLE", limit: "terceira consecutiva", fact: null, explanation: "Exceção não aplicável: terceira ocorrência consecutiva não foi identificada.", evaluationContext: "EXCEPTION" };
  const values = [facts.extraService, facts.returnToContractualBase, facts.endsDuty, facts.noOperatingCrewBeforeThirdOccurrenceInSameDuty];
  if (values.some((value) => value === false)) return { ruleKey: "GOL_THIRD_CONSECUTIVE_NIGHT_EXCEPTION", status: "FAIL", limit: "terceira consecutiva", fact: null, explanation: "Exceção aplicável, mas ao menos um requisito factual obrigatório foi documentado como falso.", evaluationContext: "EXCEPTION" };
  if (values.every((value) => value === true)) return { ruleKey: "GOL_THIRD_CONSECUTIVE_NIGHT_EXCEPTION", status: "PASS", limit: "terceira consecutiva", fact: null, explanation: "Exceção aplicável e todos os requisitos factuais obrigatórios foram confirmados.", evaluationContext: "EXCEPTION" };
  return { ruleKey: "GOL_THIRD_CONSECUTIVE_NIGHT_EXCEPTION", status: "UNKNOWN", limit: "terceira consecutiva", fact: null, explanation: "Exceção aplicável, mas requisitos factuais obrigatórios não estão documentalmente confirmados.", evaluationContext: "EXCEPTION" };
}

export function evaluateNightEarlyConsecutiveLimit(count: number | null, historyComplete: boolean, exceptionStatus?: EvaluationStatus): RuleEvaluation {
  if (count === null || (!historyComplete && count > 0)) return { ruleKey: "GOL_NIGHT_EARLY_CONSECUTIVE_LIMIT", status: "UNKNOWN", limit: "2 consecutivas", fact: count, explanation: "Histórico anterior ou classificação factual insuficiente para confirmar a sequência consecutiva." };
  if (count <= 2) return { ruleKey: "GOL_NIGHT_EARLY_CONSECUTIVE_LIMIT", status: "PASS", limit: "2 consecutivas", fact: count, explanation: `Máxima sequência factual: ${count}; limite normal: 2.` };
  if (exceptionStatus === "PASS") return { ruleKey: "GOL_NIGHT_EARLY_CONSECUTIVE_LIMIT", status: "PASS", limit: "2 consecutivas", fact: count, explanation: "Limite normal excedido; exceção da terceira consecutiva confirmada.", evaluationContext: "EXCEPTION" };
  if (exceptionStatus === "FAIL") return { ruleKey: "GOL_NIGHT_EARLY_CONSECUTIVE_LIMIT", status: "FAIL", limit: "2 consecutivas", fact: count, explanation: "Limite normal excedido; exceção da terceira consecutiva não atendida.", evaluationContext: "EXCEPTION" };
  return { ruleKey: "GOL_NIGHT_EARLY_CONSECUTIVE_LIMIT", status: "UNKNOWN", limit: "2 consecutivas", fact: count, explanation: "Third consecutive occurrence detected, but the specific ACT exception has not yet been evaluated in this package." };
}

export function evaluateVoluntary168hException(normalCount: number | null, facts: { changeVoluntary: unknown; changeOrigin: unknown; purpose: unknown; operationalDisruption: unknown; unplannedNightWindowInserted: unknown }): RuleEvaluation {
  if (normalCount === null || normalCount <= 4) return { ruleKey: "GOL_VOLUNTARY_168H_EXCEPTION", status: "NOT_APPLICABLE", limit: "acima de 4 em 168 h", fact: normalCount, explanation: "Exceção não aplicável: limite normal não foi comprovadamente excedido.", evaluationContext: "EXCEPTION" };
  const permittedOrigin = facts.changeOrigin === "PORTAL_TRADE" || facts.changeOrigin === "OPEN_TRIP" || facts.changeOrigin === "DIRECT_REQUEST";
  const values = [facts.changeVoluntary, facts.purpose, facts.operationalDisruption, facts.unplannedNightWindowInserted];
  if (facts.changeVoluntary === false || values.some((value) => value === false) || (typeof facts.changeOrigin === "string" && facts.changeOrigin !== "UNKNOWN" && !permittedOrigin)) return { ruleKey: "GOL_VOLUNTARY_168H_EXCEPTION", status: "FAIL", limit: "acima de 4 em 168 h", fact: normalCount, explanation: "Exceção aplicável, mas ao menos uma condição documental obrigatória não foi atendida.", evaluationContext: "EXCEPTION" };
  if (facts.changeVoluntary === true && permittedOrigin && facts.purpose === "MAINTAIN_ORIGINAL_PROGRAMMING" && facts.operationalDisruption === true && facts.unplannedNightWindowInserted === true) return { ruleKey: "GOL_VOLUNTARY_168H_EXCEPTION", status: "PASS", limit: "acima de 4 em 168 h", fact: normalCount, explanation: "Exceção voluntária aplicável e todas as condições documentais foram confirmadas.", evaluationContext: "EXCEPTION" };
  return { ruleKey: "GOL_VOLUNTARY_168H_EXCEPTION", status: "UNKNOWN", limit: "acima de 4 em 168 h", fact: normalCount, explanation: "Exceção aplicável, mas voluntariedade, origem ou condição operacional não está documentalmente confirmada.", evaluationContext: "EXCEPTION" };
}

export function evaluateNightEarly168hLimit(count: number | null, historyComplete: boolean, exceptionStatus?: EvaluationStatus): RuleEvaluation {
  if (!historyComplete || count === null) return { ruleKey: "GOL_NIGHT_EARLY_168H_LIMIT", status: "UNKNOWN", limit: "4 em 168 h", fact: count, explanation: "Histórico de 168 horas incompleto ou contagem factual indisponível." };
  if (count <= 4) return { ruleKey: "GOL_NIGHT_EARLY_168H_LIMIT", status: "PASS", limit: "4 em 168 h", fact: count, explanation: `Ocorrências factuais na janela de 168 horas: ${count}; limite normal: 4.` };
  if (exceptionStatus === "PASS") return { ruleKey: "GOL_NIGHT_EARLY_168H_LIMIT", status: "PASS", limit: "4 em 168 h", fact: count, explanation: "Limite normal excedido; exceção voluntária confirmada.", evaluationContext: "EXCEPTION" };
  if (exceptionStatus === "FAIL") return { ruleKey: "GOL_NIGHT_EARLY_168H_LIMIT", status: "FAIL", limit: "4 em 168 h", fact: count, explanation: "Limite normal excedido; exceção voluntária não atendida.", evaluationContext: "EXCEPTION" };
  return { ruleKey: "GOL_NIGHT_EARLY_168H_LIMIT", status: "UNKNOWN", limit: "4 em 168 h", fact: count, explanation: "Normal limit exceeded, but voluntary-change exception has not yet been evaluated." };
}

export function evaluateNightEarly48hReset(value: unknown): RuleEvaluation {
  if (value === true) return { ruleKey: "GOL_NIGHT_EARLY_48H_RESET", status: "PASS", limit: "48 h livre", fact: null, explanation: "ACT reset condition identified." };
  if (value === false) return { ruleKey: "GOL_NIGHT_EARLY_48H_RESET", status: "NOT_APPLICABLE", limit: "48 h livre", fact: null, explanation: "Não há fato documental de intervalo livre de 48 horas." };
  return { ruleKey: "GOL_NIGHT_EARLY_48H_RESET", status: "UNKNOWN", limit: "48 h livre", fact: null, explanation: "Fato documental de intervalo livre de 48 horas indisponível." };
}

export function evaluateRbacAfterTwoNights(regime: unknown, consecutive: number | null, lookbackComplete: boolean, reportMinutes: number | null, voluntaryContext: boolean): RuleEvaluation {
  if (regime === "UNKNOWN" || !regime) return { ruleKey: "RBAC117_AFTER_TWO_NIGHTS_EARLY_REPORT_PROHIBITION", status: "UNKNOWN", limit: "06:00-08:00", fact: consecutive, explanation: "Não avaliável: regime RBAC 117 do operador não confirmado." };
  if (!lookbackComplete || consecutive === null || reportMinutes === null) return { ruleKey: "RBAC117_AFTER_TWO_NIGHTS_EARLY_REPORT_PROHIBITION", status: "UNKNOWN", limit: "06:00-08:00", fact: consecutive, explanation: "Lookback factual de 48 horas incompleto." };
  if (consecutive < 2) return { ruleKey: "RBAC117_AFTER_TWO_NIGHTS_EARLY_REPORT_PROHIBITION", status: "NOT_APPLICABLE", limit: "06:00-08:00", fact: consecutive, explanation: "Não foram identificadas duas madrugadas consecutivas." };
  if (reportMinutes >= 360 && reportMinutes <= 480) return { ruleKey: "RBAC117_AFTER_TWO_NIGHTS_EARLY_REPORT_PROHIBITION", status: voluntaryContext ? "UNKNOWN" : "FAIL", limit: "06:00-08:00", fact: consecutive, explanation: voluntaryContext ? "Contexto voluntário potencialmente relevante; exceção ainda não avaliada." : "Apresentação documental dentro da janela proibida de 06:00-08:00." };
  return { ruleKey: "RBAC117_AFTER_TWO_NIGHTS_EARLY_REPORT_PROHIBITION", status: "PASS", limit: "06:00-08:00", fact: consecutive, explanation: "Apresentação documental fora da janela proibida." };
}

export function evaluateRbacPostFourNights(regime: unknown, count: number | null, historyComplete: boolean, additionalActivities: number | null): RuleEvaluation {
  if (regime === "UNKNOWN" || !regime) return { ruleKey: "RBAC117_POST_FOUR_NIGHTS_ACTIVITY_LIMIT", status: "UNKNOWN", limit: "1 atividade adicional", fact: count, explanation: "Não avaliável: regime RBAC 117 do operador não confirmado." };
  if (!historyComplete || count === null || additionalActivities === null) return { ruleKey: "RBAC117_POST_FOUR_NIGHTS_ACTIVITY_LIMIT", status: "UNKNOWN", limit: "1 atividade adicional", fact: count, explanation: "Histórico ou âncora factual de 168 horas incompleto." };
  if (count < 4) return { ruleKey: "RBAC117_POST_FOUR_NIGHTS_ACTIVITY_LIMIT", status: "NOT_APPLICABLE", limit: "1 atividade adicional", fact: count, explanation: "Menos de quatro madrugadas RBAC na janela." };
  return { ruleKey: "RBAC117_POST_FOUR_NIGHTS_ACTIVITY_LIMIT", status: additionalActivities <= 1 ? "PASS" : "FAIL", limit: "1 atividade adicional", fact: additionalActivities, explanation: `Atividades adicionais restritas: ${additionalActivities}.` };
}

export function evaluateRbacNightReset(regime: unknown, free48h: unknown, localNights: number | null): RuleEvaluation {
  if (regime === "UNKNOWN" || !regime) return { ruleKey: "RBAC117_NIGHT_168H_RESET", status: "UNKNOWN", limit: "48 h + 2 noites locais", fact: localNights, explanation: "Não avaliável: regime RBAC 117 do operador não confirmado." };
  if (free48h !== true && free48h !== false || localNights === null) return { ruleKey: "RBAC117_NIGHT_168H_RESET", status: "UNKNOWN", limit: "48 h + 2 noites locais", fact: localNights, explanation: "Fato de intervalo livre ou noites locais indisponível." };
  if (!free48h) return { ruleKey: "RBAC117_NIGHT_168H_RESET", status: "NOT_APPLICABLE", limit: "48 h + 2 noites locais", fact: localNights, explanation: "Não há intervalo livre de 48 horas." };
  return { ruleKey: "RBAC117_NIGHT_168H_RESET", status: localNights >= 2 ? "PASS" : "FAIL", limit: "48 h + 2 noites locais", fact: localNights, explanation: localNights >= 2 ? "Condição RBAC de reset identificada." : "Intervalo de 48 horas sem duas noites locais." };
}

export function evaluateMonthlyOff(days: number | null, voluntary: unknown): RuleEvaluation { if (days === null) return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "UNKNOWN", limit: "10 dias", fact: null, explanation: "Quantidade factual de folgas mensais indisponível." }; if (days >= 10) return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "PASS", limit: "10 dias", fact: days, explanation: "Quantidade factual de folgas mensais atende ao mínimo normal." }; if (days < 8) return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "FAIL", limit: "8 dias voluntário / 10 normal", fact: days, explanation: "Quantidade factual abaixo do piso de 8 dias." }; if (voluntary === true || voluntary === "TRUE") return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "PASS", limit: "8 dias voluntário", fact: days, explanation: "Piso voluntário factual de 8 dias aplicado.", evaluationContext: "EXCEPTION" }; if (voluntary === false || voluntary === "FALSE") return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "FAIL", limit: "10 dias", fact: days, explanation: "Voluntariedade documentalmente negada." }; return { ruleKey: "GOL_MONTHLY_OFF_MINIMUM", status: "UNKNOWN", limit: "10 dias", fact: days, explanation: "Voluntariedade não documentada para redução do piso." }; }
export function evaluateWeekendOff(qualifying: boolean | null, startsByNoon: boolean | null = qualifying): RuleEvaluation {
  if (qualifying === null || startsByNoon === null) return { ruleKey: "GOL_MONTHLY_GROUPED_WEEKEND_OFF", status: "UNKNOWN", limit: "sábado e domingo; início até 12:00", fact: null, explanation: "Fatos de folga agrupada insuficientes." };
  const passes = qualifying && startsByNoon;
  return { ruleKey: "GOL_MONTHLY_GROUPED_WEEKEND_OFF", status: passes ? "PASS" : "FAIL", limit: "sábado e domingo; início até 12:00", fact: null, explanation: passes ? "Bloco factual de fim de semana encontrado dentro do horário limite." : "Nenhum bloco factual qualificável até 12:00 de sábado foi encontrado." };
}
export function evaluateOffDelay(delay: number | null, exceptional: EvaluationStatus): RuleEvaluation { if (delay === null) return { ruleKey: "GOL_OFF_START_DELAY", status: "UNKNOWN", limit: "240 min", fact: null, explanation: "Matching ou delta factual indisponível." }; if (delay <= 240) return { ruleKey: "GOL_OFF_START_DELAY", status: "PASS", limit: "240 min", fact: delay, explanation: "Postergação factual dentro do limite ordinário." }; return exceptional === "PASS" ? { ruleKey: "GOL_OFF_START_DELAY", status: "PASS", limit: "240 min", fact: delay, explanation: "Postergação coberta por exceção factual.", evaluationContext: "EXCEPTION" } : exceptional === "FAIL" ? { ruleKey: "GOL_OFF_START_DELAY", status: "FAIL", limit: "240 min", fact: delay, explanation: "Postergação sem exceção confirmada." } : { ruleKey: "GOL_OFF_START_DELAY", status: "UNKNOWN", limit: "240 min", fact: delay, explanation: "Exceção de postergação não documentada." }; }
export function evaluateExceptionalOffDelay(delay: number | null, reason: unknown): RuleEvaluation { if (delay === null || delay <= 240) return { ruleKey: "GOL_OFF_EXCEPTIONAL_START_DELAY", status: "NOT_APPLICABLE", limit: "241-720 min", fact: delay, explanation: "Exceção não aplicável." , evaluationContext: "EXCEPTION"}; if (delay > 720) return { ruleKey: "GOL_OFF_EXCEPTIONAL_START_DELAY", status: "FAIL", limit: "720 min", fact: delay, explanation: "Postergação factual acima de 720 minutos.", evaluationContext: "EXCEPTION" }; if (["WEATHER","UNSCHEDULED_MAINTENANCE","IMPERIOUS_NECESSITY"].includes(String(reason))) return { ruleKey: "GOL_OFF_EXCEPTIONAL_START_DELAY", status: "PASS", limit: "241-720 min", fact: delay, explanation: "Motivo excepcional factual confirmado.", evaluationContext: "EXCEPTION" }; return { ruleKey: "GOL_OFF_EXCEPTIONAL_START_DELAY", status: reason === "UNKNOWN" || reason === null ? "UNKNOWN" : "FAIL", limit: "241-720 min", fact: delay, explanation: "Motivo excepcional não confirmado.", evaluationContext: "EXCEPTION" }; }
export function evaluateSingleNights(nights: unknown): RuleEvaluation { return typeof nights !== "number" ? { ruleKey: "GOL_SINGLE_OFF_TWO_LOCAL_NIGHTS", status: "UNKNOWN", limit: "2 noites", fact: null, explanation: "Noites locais indisponíveis." } : { ruleKey: "GOL_SINGLE_OFF_TWO_LOCAL_NIGHTS", status: nights >= 2 ? "PASS" : "FAIL", limit: "2 noites", fact: nights, explanation: "Noites locais factuais avaliadas." }; }
export function evaluateSingleReport(type: unknown, start: string | null, timezone: string | null, exceptionStatus: EvaluationStatus): RuleEvaluation {
  if (type === "GROUND_TRAINING") return { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "NOT_APPLICABLE", limit: "após 10:00", fact: null, explanation: "Treinamento em solo não é aplicável." };
  if (!["FLIGHT", "RESERVE", "STANDBY"].includes(String(type)) || !start || !timezone) return { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "UNKNOWN", limit: "após 10:00", fact: null, explanation: "Próxima atividade, horário ou fuso local indisponível." };
  const timestamp = Date.parse(start);
  if (!Number.isFinite(timestamp)) return { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "UNKNOWN", limit: "após 10:00", fact: null, explanation: "Horário factual inválido." };
  let minute: number;
  try {
    const parts = new Intl.DateTimeFormat("en-GB", { timeZone: timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(timestamp));
    const hour = Number(parts.find((part) => part.type === "hour")?.value);
    const minutes = Number(parts.find((part) => part.type === "minute")?.value);
    if (!Number.isInteger(hour) || !Number.isInteger(minutes)) throw new Error("Local time unavailable");
    minute = hour * 60 + minutes;
  } catch {
    return { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "UNKNOWN", limit: "após 10:00", fact: null, explanation: "Fuso local factual inválido ou indisponível." };
  }
  if (minute > 600) return { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "PASS", limit: "após 10:00", fact: minute, explanation: "Apresentação factual após 10:00 local." };
  return exceptionStatus === "PASS" ? { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "PASS", limit: "após 10:00", fact: minute, explanation: "Exceção voluntária factual confirmada.", evaluationContext: "EXCEPTION" } : exceptionStatus === "FAIL" ? { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "FAIL", limit: "após 10:00", fact: minute, explanation: "Apresentação factual não posterior a 10:00 local." } : { ruleKey: "GOL_SINGLE_OFF_NEXT_REPORT_TIME", status: "UNKNOWN", limit: "após 10:00", fact: minute, explanation: "Exceção voluntária não documentada." };
}
export type SingleOffExceptionAvailability = { evaluation: RuleEvaluation; compositionStatus: EvaluationStatus };

export function evaluateSingleExceptionAvailability(voluntary: unknown, substitution: unknown, generated: unknown, needed: boolean | null): SingleOffExceptionAvailability {
  const unavailable = (explanation: string, compositionStatus: EvaluationStatus): SingleOffExceptionAvailability => ({ evaluation: { ruleKey: "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION", status: "NOT_APPLICABLE", limit: "substituição voluntária", fact: null, explanation, evaluationContext: "EXCEPTION" }, compositionStatus });
  if (generated === false || generated === "FALSE") return unavailable("Não se aplica: a folga única não foi gerada por substituição documental.", needed === true ? "FAIL" : "NOT_APPLICABLE");
  if (needed === false) return unavailable("Não se aplica: nenhuma regra principal requer a exceção para este período.", "NOT_APPLICABLE");
  if (needed === null) return { evaluation: { ruleKey: "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION", status: "UNKNOWN", limit: "substituição voluntária", fact: null, explanation: "Não foi possível determinar se a exceção é necessária com os fatos documentais disponíveis.", evaluationContext: "EXCEPTION" }, compositionStatus: "UNKNOWN" };
  const values = [voluntary, substitution, generated];
  if (values.every((value) => value === true || value === "TRUE")) return { evaluation: { ruleKey: "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION", status: "PASS", limit: "substituição voluntária", fact: null, explanation: "Todos os fatos da exceção foram confirmados.", evaluationContext: "EXCEPTION" }, compositionStatus: "PASS" };
  if (values.some((value) => value === false || value === "FALSE")) return unavailable("Exceção não disponível para composição: uma condição documental obrigatória foi negada.", "FAIL");
  return { evaluation: { ruleKey: "GOL_VOLUNTARY_TRADE_SINGLE_OFF_EXCEPTION", status: "UNKNOWN", limit: "substituição voluntária", fact: null, explanation: "A exceção é necessária, mas voluntariedade ou substituição não está documentada.", evaluationContext: "EXCEPTION" }, compositionStatus: "UNKNOWN" };
}

export function evaluateSingleException(voluntary: unknown, substitution: unknown, generated: unknown): RuleEvaluation {
  return evaluateSingleExceptionAvailability(voluntary, substitution, generated, true).evaluation;
}

export function evaluateMinimumRestAfterDuty(dutyMinutes: number | null, restMinutes: number | null): RuleEvaluation {
  if (dutyMinutes === null || restMinutes === null) return { ruleKey: "LAW_MINIMUM_REST_AFTER_DUTY", status: "UNKNOWN", limit: "12/16/24 h", fact: restMinutes, explanation: "Duração da jornada ou do repouso factual indisponível." };
  const required = dutyMinutes <= 720 ? 720 : dutyMinutes <= 900 ? 960 : 1440;
  return { ruleKey: "LAW_MINIMUM_REST_AFTER_DUTY", status: restMinutes >= required ? "PASS" : "FAIL", limit: `${required} min`, fact: restMinutes, explanation: `Jornada factual: ${dutyMinutes} min; repouso mínimo legal: ${required} min; repouso factual: ${restMinutes} min.` };
}

export function evaluateContractualBase(documentBase: unknown, profileBase: unknown): RuleEvaluation {
  if (typeof documentBase !== "string" || !documentBase || typeof profileBase !== "string" || !profileBase) return { ruleKey: "GOL_CONTRACTUAL_BASE_CLASSIFICATION", status: "UNKNOWN", limit: "bases documentais coincidentes", fact: null, explanation: "Base contratual documental ou de perfil indisponível." };
  if (documentBase !== profileBase) return { ruleKey: "GOL_CONTRACTUAL_BASE_CLASSIFICATION", status: "UNKNOWN", limit: "bases documentais coincidentes", fact: null, explanation: "CONTRACTUAL_BASE_MISMATCH_REVIEW_REQUIRED" };
  return { ruleKey: "GOL_CONTRACTUAL_BASE_CLASSIFICATION", status: "PASS", limit: "bases documentais coincidentes", fact: null, explanation: `Base contratual confirmada: ${documentBase}.` };
}

function additiveAirportRule(ruleKey: string, airport: unknown, base: unknown, label: string): RuleEvaluation {
  if (typeof airport !== "string" || !airport || typeof base !== "string" || !base) return { ruleKey, status: "UNKNOWN", limit: "+60 min", fact: null, explanation: `Base contratual ou aeroporto de ${label} indisponível.` };
  if (airport === base) return { ruleKey, status: "NOT_APPLICABLE", limit: "+60 min", fact: 0, explanation: `${label} na base contratual.` };
  return { ruleKey, status: "PASS", limit: "+60 min", fact: 60, explanation: `${label} fora da base contratual; incremento factual aplicável de 60 min.`, evaluationContext: "TRIGGER" };
}

export const evaluateDifferentAirportPreRest = (startAirport: unknown, base: unknown) => additiveAirportRule("GOL_DIFFERENT_AIRPORT_PRE_REST_INCREMENT", startAirport, base, "Início da viagem");
export const evaluateDifferentAirportPostRest = (endAirport: unknown, base: unknown) => additiveAirportRule("GOL_DIFFERENT_AIRPORT_POST_REST_INCREMENT", endAirport, base, "Término da viagem");

export function evaluateDifferentAirportBothRest(previousEnd: unknown, nextStart: unknown, base: unknown): RuleEvaluation {
  if (typeof previousEnd !== "string" || !previousEnd || typeof nextStart !== "string" || !nextStart || typeof base !== "string" || !base) return { ruleKey: "GOL_DIFFERENT_AIRPORT_BOTH_REST_INCREMENT", status: "UNKNOWN", limit: "+120 min", fact: null, explanation: "Base contratual ou aeroportos do intervalo de repouso indisponíveis." };
  if (previousEnd === base || nextStart === base) return { ruleKey: "GOL_DIFFERENT_AIRPORT_BOTH_REST_INCREMENT", status: "NOT_APPLICABLE", limit: "+120 min", fact: 0, explanation: "Cenário conjunto de aeroportos diferentes não confirmado." };
  return { ruleKey: "GOL_DIFFERENT_AIRPORT_BOTH_REST_INCREMENT", status: "PASS", limit: "+120 min", fact: 120, explanation: "Término anterior e início seguinte fora da base contratual; incremento específico de 120 min aplicável.", evaluationContext: "TRIGGER" };
}

export function evaluateCghGruAdditionalRest(periodStart: string | null, base: unknown, airports: Array<unknown>, voluntary: unknown, origin: unknown): RuleEvaluation {
  if (!periodStart || periodStart < "2026-03-01") return { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "NOT_APPLICABLE", limit: "+60 min desde 2026-03-01", fact: 0, explanation: "Vigência específica ainda não aplicável." };
  if (typeof base !== "string" || !base || airports.some((airport) => typeof airport !== "string" || !airport)) return { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "UNKNOWN", limit: "+60 min", fact: null, explanation: "Base contratual ou aeroporto documental indisponível." };
  if (!(["CGH", "GRU"].includes(base) && airports.some((airport) => airport !== base && ["CGH", "GRU"].includes(String(airport))))) return { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "NOT_APPLICABLE", limit: "+60 min", fact: 0, explanation: "Cenário CGH/GRU não aplicável." };
  const permittedOrigin = origin === "PORTAL_TRADE" || origin === "OPEN_TRIP";
  if (voluntary === true || voluntary === "TRUE") return permittedOrigin ? { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "NOT_APPLICABLE", limit: "+60 min", fact: 0, explanation: "Exceção por troca voluntária documentalmente confirmada.", evaluationContext: "EXCEPTION" } : { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "UNKNOWN", limit: "+60 min", fact: null, explanation: "Troca voluntária confirmada, mas origem permitida não documentada." };
  if (voluntary === false || voluntary === "FALSE") return { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "PASS", limit: "+60 min", fact: 60, explanation: "Cenário CGH/GRU aplicável sem troca voluntária confirmada.", evaluationContext: "TRIGGER" };
  return { ruleKey: "GOL_CGH_GRU_ADDITIONAL_REST", status: "UNKNOWN", limit: "+60 min", fact: null, explanation: "Voluntariedade ou origem da alteração potencialmente relevante não documentada." };
}

export function evaluateTimezoneCrossingRestIncrement(timezoneCount: unknown, returnedToBase: unknown): RuleEvaluation {
  if (typeof timezoneCount !== "number") return { ruleKey: "LAW_TIMEZONE_CROSSING_REST_INCREMENT", status: "UNKNOWN", limit: "3+ fusos", fact: null, explanation: "Quantidade factual de fusos cruzados indisponível." };
  if (timezoneCount < 3) return { ruleKey: "LAW_TIMEZONE_CROSSING_REST_INCREMENT", status: "NOT_APPLICABLE", limit: "3+ fusos", fact: 0, explanation: "Menos de três fusos factualmente cruzados." };
  if (returnedToBase !== true) return { ruleKey: "LAW_TIMEZONE_CROSSING_REST_INCREMENT", status: returnedToBase === false ? "NOT_APPLICABLE" : "UNKNOWN", limit: "3+ fusos e retorno à base", fact: null, explanation: returnedToBase === false ? "Retorno à base contratual não identificado." : "Retorno à base contratual indisponível." };
  return { ruleKey: "LAW_TIMEZONE_CROSSING_REST_INCREMENT", status: "PASS", limit: "120 min por fuso", fact: timezoneCount * 120, explanation: `${timezoneCount} fusos factualmente cruzados com retorno à base; incremento aplicável.`, evaluationContext: "TRIGGER" };
}

export function evaluateRestTransportDelay(dutyEnd: string | null, transportAvailableAt: string | null): RuleEvaluation {
  if (!dutyEnd || !transportAvailableAt) return { ruleKey: "LAW_REST_TRANSPORT_DELAY", status: "UNKNOWN", limit: "início efetivo do repouso", fact: null, explanation: "Fim documental da jornada ou disponibilidade de transporte indisponível." };
  const delay = Math.round((Date.parse(transportAvailableAt) - Date.parse(dutyEnd)) / 60000);
  if (!Number.isFinite(delay) || delay < 0) return { ruleKey: "LAW_REST_TRANSPORT_DELAY", status: "UNKNOWN", limit: "início efetivo do repouso", fact: null, explanation: "Âncora documental de transporte inválida." };
  return { ruleKey: "LAW_REST_TRANSPORT_DELAY", status: "PASS", limit: "início efetivo do repouso", fact: delay, explanation: `Fim documental: ${dutyEnd}; transporte disponível: ${transportAvailableAt}; início efetivo do repouso: ${transportAvailableAt}.` };
}

export function evaluateInterairportTransportRequirement(base: unknown, startAirport: unknown, endAirport: unknown): RuleEvaluation {
  if (typeof base !== "string" || !base || typeof startAirport !== "string" || !startAirport || typeof endAirport !== "string" || !endAirport) return { ruleKey: "GOL_INTERAIRPORT_TRANSPORT_REQUIREMENT", status: "UNKNOWN", limit: "transporte entre aeroportos", fact: null, explanation: "Base contratual ou aeroportos documentais indisponíveis." };
  if (startAirport === base && endAirport === base) return { ruleKey: "GOL_INTERAIRPORT_TRANSPORT_REQUIREMENT", status: "NOT_APPLICABLE", limit: "transporte entre aeroportos", fact: 0, explanation: "Início e término na base contratual." };
  return { ruleKey: "GOL_INTERAIRPORT_TRANSPORT_REQUIREMENT", status: "PASS", limit: "transporte entre aeroportos", fact: 1, explanation: "transport_required = true; transport_provided = UNKNOWN.", evaluationContext: "TRIGGER" };
}

export function evaluateVirtualBaseStandbyReserveLocation(active: unknown, virtualBase: unknown, location: unknown, assignedProgramStart: unknown): RuleEvaluation {
  if (active === false || active === "INACTIVE" || active === "FALSE") return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: "NOT_APPLICABLE", limit: "base virtual", fact: null, explanation: "Base virtual inativa." };
  if (!(active === true || active === "ACTIVE" || active === "TRUE")) return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: "UNKNOWN", limit: "base virtual", fact: null, explanation: "Status de base virtual indisponível." };
  if (typeof virtualBase !== "string" || !virtualBase || typeof location !== "string" || !location) return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: "UNKNOWN", limit: "base virtual", fact: null, explanation: "Base virtual ou localização de sobreaviso/reserva indisponível." };
  if (location !== virtualBase) return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: "FAIL", limit: "base virtual", fact: null, explanation: "Sobreaviso ou reserva documentalmente fora da base virtual." };
  if (typeof assignedProgramStart !== "string" || !assignedProgramStart) return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: "UNKNOWN", limit: "base virtual", fact: null, explanation: "Local de início da programação acionada indisponível." };
  return { ruleKey: "GOL_VIRTUAL_BASE_STANDBY_RESERVE_LOCATION", status: assignedProgramStart === virtualBase ? "PASS" : "FAIL", limit: "base virtual", fact: null, explanation: assignedProgramStart === virtualBase ? "Sobreaviso ou reserva e programação iniciam na base virtual." : "Programação acionada não inicia na base virtual." };
}

export function evaluateRbacRegimeGate(regime: unknown): RuleEvaluation { return regime === "A" || regime === "B" || regime === "C" ? { ruleKey: "RBAC117_OPERATOR_REGIME_GATE", status: "PASS", limit: "regime confirmado", fact: null, explanation: `Regime RBAC 117 confirmado: ${regime}.` } : { ruleKey: "RBAC117_OPERATOR_REGIME_GATE", status: "UNKNOWN", limit: "regime confirmado", fact: null, explanation: "OPERATOR_RBAC117_REGIME_UNKNOWN" }; }
type BLimit = { duty: number; flight: number };
function bLimit(presentationMinute: number, operatingLegs: number): BLimit { const column = operatingLegs <= 2 ? 0 : operatingLegs <= 4 ? 1 : operatingLegs === 5 ? 2 : operatingLegs === 6 ? 3 : 4; const row = presentationMinute >= 360 && presentationMinute < 420 ? [[660,540],[660,540],[600,480],[540,480],[540,480]] : presentationMinute < 480 ? [[780,570],[720,540],[660,540],[600,480],[540,480]] : presentationMinute < 720 ? [[780,600],[780,570],[720,540],[660,540],[600,480]] : presentationMinute < 840 ? [[720,570],[720,540],[660,540],[600,480],[540,480]] : presentationMinute < 960 ? [[660,540],[660,540],[600,480],[540,480],[540,480]] : presentationMinute < 1080 ? [[600,480],[600,480],[540,480],[540,480],[540,480]] : [[540,480],[540,480],[540,420],[540,420],[540,420]]; const [duty, flight] = row[column]; return { duty, flight }; }
export function evaluateRbacBAcclimatizedLimit(regime: unknown, crew: unknown, acclimatization: unknown, presentationMinute: number | null, operatingLegs: number | null, dutyMinutes: number | null, flightMinutes: number | null, dutyExtension: EvaluationStatus = "FAIL", flightExtension: EvaluationStatus = "FAIL"): RuleEvaluation { if (regime !== "B") return { ruleKey: "RBAC117_B_ACCLIMATIZED_DUTY_FLIGHT_LIMIT", status: regime === "UNKNOWN" ? "UNKNOWN" : "NOT_APPLICABLE", limit: "Tabela B", fact: null, explanation: regime === "UNKNOWN" ? "OPERATOR_RBAC117_REGIME_UNKNOWN" : "Regime B não aplicável." }; if (crew !== "SIMPLE") return { ruleKey: "RBAC117_B_ACCLIMATIZED_DUTY_FLIGHT_LIMIT", status: "NOT_APPLICABLE", limit: "Tabela B simples", fact: null, explanation: "Tripulação simples não confirmada." }; if (acclimatization !== "ACCLIMATED" || presentationMinute === null || operatingLegs === null || dutyMinutes === null || flightMinutes === null) return { ruleKey: "RBAC117_B_ACCLIMATIZED_DUTY_FLIGHT_LIMIT", status: "UNKNOWN", limit: "Tabela B", fact: null, explanation: "Aclimatação ou fatos de jornada/voo indisponíveis." }; const limit=bLimit(presentationMinute,operatingLegs); const okDuty=dutyMinutes<=limit.duty||dutyExtension==="PASS"; const okFlight=flightMinutes<=limit.flight||flightExtension==="PASS"; return {ruleKey:"RBAC117_B_ACCLIMATIZED_DUTY_FLIGHT_LIMIT",status:okDuty&&okFlight?"PASS":"FAIL",limit:`duty ${limit.duty} / FT ${limit.flight} min`,fact:dutyMinutes,explanation:`Tabela B: ${operatingLegs} etapas operantes; duty ${dutyMinutes}; FT ${flightMinutes}.`}; }
export function evaluateUnknownAcclimatizationReduction(regime: unknown, state: unknown, presentationMinute: number | null, legs: number | null): RuleEvaluation { if(regime!=="B")return{ruleKey:"RBAC117_B_UNKNOWN_ACCLIMATIZATION_REDUCTION",status:regime==="UNKNOWN"?"UNKNOWN":"NOT_APPLICABLE",limit:"-60 min",fact:null,explanation:regime==="UNKNOWN"?"OPERATOR_RBAC117_REGIME_UNKNOWN":"Regime B não aplicável."};if(state!=="UNKNOWN")return{ruleKey:"RBAC117_B_UNKNOWN_ACCLIMATIZATION_REDUCTION",status:"NOT_APPLICABLE",limit:"-60 min",fact:null,explanation:"Aclimatação desconhecida não aplicável."};if(presentationMinute===null||legs===null)return{ruleKey:"RBAC117_B_UNKNOWN_ACCLIMATIZATION_REDUCTION",status:"UNKNOWN",limit:"-60 min",fact:null,explanation:"Fatos da tabela B indisponíveis."};const normal=bLimit(presentationMinute,legs).duty;return{ruleKey:"RBAC117_B_UNKNOWN_ACCLIMATIZATION_REDUCTION",status:"PASS",limit:"-60 min",fact:normal-60,explanation:`Limite normal ${normal} min; limite ajustado ${normal-60} min.`,evaluationContext:"TRIGGER"}; }
export function evaluateAccumulatedLimit(ruleKey:string, regime:unknown, value:unknown, historyComplete:unknown, limit:number, gated=true):RuleEvaluation {if(gated&&regime!=="B"&&regime!=="C")return{ruleKey,status:regime==="UNKNOWN"?"UNKNOWN":"NOT_APPLICABLE",limit:`${limit} min`,fact:null,explanation:regime==="UNKNOWN"?"OPERATOR_RBAC117_REGIME_UNKNOWN":"Regra RBAC não aplicável."};if(historyComplete!==true||typeof value!=="number")return{ruleKey,status:"UNKNOWN",limit:`${limit} min`,fact:null,explanation:"Histórico ou total factual incompleto."};return{ruleKey,status:value<=limit?"PASS":"FAIL",limit:`${limit} min`,fact:value,explanation:`Total factual: ${value} min.`};}
export function evaluateSingleRolling(value: unknown, complete: unknown, date: string, exceptionStatus: EvaluationStatus): RuleEvaluation { if(complete!==true||typeof value!=="number")return{ruleKey:"GOL_SINGLE_OFF_ROLLING_30D_LIMIT",status:"UNKNOWN",limit:"30 dias",fact:null,explanation:"Histórico de 30 dias incompleto."};const max=date>="2026-03-01"?2:3;if(value<=max)return{ruleKey:"GOL_SINGLE_OFF_ROLLING_30D_LIMIT",status:"PASS",limit:`${max} em 30 dias`,fact:value,explanation:"Contagem factual dentro do limite."};return exceptionStatus==="PASS"?{ruleKey:"GOL_SINGLE_OFF_ROLLING_30D_LIMIT",status:"PASS",limit:`${max} em 30 dias`,fact:value,explanation:"Exceção voluntária factual confirmada.",evaluationContext:"EXCEPTION"}:exceptionStatus==="FAIL"?{ruleKey:"GOL_SINGLE_OFF_ROLLING_30D_LIMIT",status:"FAIL",limit:`${max} em 30 dias`,fact:value,explanation:"Contagem acima do limite sem exceção."}:{ruleKey:"GOL_SINGLE_OFF_ROLLING_30D_LIMIT",status:"UNKNOWN",limit:`${max} em 30 dias`,fact:value,explanation:"Exceção voluntária não documentada."}; }
export function evaluateConsecutiveSingle(value: unknown, date: string, exceptionStatus: EvaluationStatus): RuleEvaluation { if(date<"2026-03-01")return{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"NOT_APPLICABLE",limit:"desde 2026-03-01",fact:null,explanation:"Regra ainda não vigente."};if(value==="FALSE")return{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"PASS",limit:"sem consecutividade",fact:null,explanation:"Não há consecutividade factual."};if(value!=="TRUE")return{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"UNKNOWN",limit:"sem consecutividade",fact:null,explanation:"Consecutividade factual indisponível."};return exceptionStatus==="PASS"?{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"PASS",limit:"sem consecutividade",fact:null,explanation:"Exceção voluntária factual confirmada.",evaluationContext:"EXCEPTION"}:exceptionStatus==="FAIL"?{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"FAIL",limit:"sem consecutividade",fact:null,explanation:"Consecutividade factual sem exceção."}:{ruleKey:"GOL_CONSECUTIVE_SINGLE_OFF_PROHIBITION",status:"UNKNOWN",limit:"sem consecutividade",fact:null,explanation:"Exceção voluntária não documentada."}; }

function rbacGate(ruleKey: string, regime: unknown, bOnly = false): RuleEvaluation | null {
  if (regime === "UNKNOWN" || !regime) return { ruleKey, status: "UNKNOWN", limit: "RBAC 117", fact: null, explanation: "OPERATOR_RBAC117_REGIME_UNKNOWN" };
  if (bOnly ? regime !== "B" : regime !== "B" && regime !== "C") return { ruleKey, status: "NOT_APPLICABLE", limit: "RBAC 117", fact: null, explanation: "Regime RBAC não aplicável a esta regra." };
  return null;
}
const known = (value: unknown) => value === true || value === "TRUE";
const unknown = (value: unknown) => value === null || value === undefined || value === "UNKNOWN";
const result = (ruleKey: string, status: EvaluationStatus, limit: string, fact: number | null, explanation: string, evaluationContext?: RuleEvaluation["evaluationContext"]): RuleEvaluation => ({ ruleKey, status, limit, fact, explanation, ...(evaluationContext ? { evaluationContext } : {}) });

export function evaluateRbacAugmentedCrew(regime: unknown, facts: Record<string, unknown>, presentationMinute: number | null, dutyMinutes: number | null, flightMinutes: number | null): RuleEvaluation {
  const gate = rbacGate("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", regime, true); if (gate) return gate;
  if (facts.crewComposition === "SIMPLE") return result("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", "NOT_APPLICABLE", "Tabela B tripulação aumentada", null, "Tripulação simples documentada.");
  if (facts.crewComposition !== "COMPOSED" && facts.crewComposition !== "RELIEF") return result("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", "UNKNOWN", "Tabela B tripulação aumentada", null, "Composição da tripulação indisponível.");
  if (facts.augmentedCrewEligibleFactsComplete !== "TRUE" || presentationMinute === null || dutyMinutes === null || flightMinutes === null) return result("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", "UNKNOWN", "Tabela B tripulação aumentada", null, "Fatos mínimos de tripulação aumentada incompletos.");
  const rows = presentationMinute >= 360 && presentationMinute < 420 ? [[900,1020],[840,960],[780,840]] : presentationMinute >= 420 && presentationMinute < 840 ? [[960,1080],[900,1020],[840,900]] : presentationMinute >= 840 && presentationMinute < 1080 ? [[900,960],[840,960],[780,840]] : [[840,960],[780,840],[720,780]];
  const restClass = facts.inflightRestClass === "CLASS_1" ? 0 : facts.inflightRestClass === "CLASS_2" ? 1 : facts.inflightRestClass === "CLASS_3" ? 2 : -1;
  if (restClass < 0 || typeof facts.operatingLegCount !== "number" || typeof facts.plannedInflightRestMinutes !== "number" || !["TRUE", "FALSE"].includes(String(facts.performsFinalLanding))) return result("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", "UNKNOWN", "Tabela B tripulação aumentada", null, "Classe, descanso, etapas ou pouso final indisponíveis.");
  const [dutyLimit, flightLimit] = rows[restClass]; const relief = facts.crewComposition === "RELIEF"; const adjustedDutyLimit = relief ? dutyLimit + 120 : dutyLimit; const plannedOver16 = dutyMinutes > 960; const requiredRest = plannedOver16 ? (facts.performsFinalLanding === "TRUE" ? 180 : 120) : (facts.performsFinalLanding === "TRUE" ? 120 : 90); const legLimit = plannedOver16 ? 2 : 3;
  const passes = dutyMinutes <= adjustedDutyLimit && flightMinutes <= flightLimit && facts.plannedInflightRestMinutes >= requiredRest && facts.operatingLegCount <= legLimit;
  return result("RBAC117_B_AUGMENTED_CREW_DUTY_FLIGHT_LIMIT", passes ? "PASS" : "FAIL", `duty ${adjustedDutyLimit} / FT ${flightLimit} min; rest ${requiredRest} min; legs ${legLimit}`, dutyMinutes, "Tabela B aplicada aos fatos documentados de tripulação aumentada.");
}

export function evaluateRbacExtension(ruleKey: "RBAC117_DUTY_EXTENSION" | "RBAC117_FLIGHT_TIME_EXTENSION" | "RBAC117_ADDITIONAL_LEG_EXTENSION", regime: unknown, crew: unknown, extension: unknown, circumstance: unknown, commander: unknown): RuleEvaluation {
  const gate = rbacGate(ruleKey, regime); if (gate) return gate;
  if (extension === 0 || extension === false || extension === "FALSE") return result(ruleKey, "NOT_APPLICABLE", "extensão aplicável", typeof extension === "number" ? extension : null, "Não há extensão factual aplicável.", "EXCEPTION");
  if (unknown(extension)) return result(ruleKey, "UNKNOWN", "extensão aplicável", null, "Necessidade ou valor factual da extensão indisponível.", "EXCEPTION");
  if (crew !== "SIMPLE" && crew !== "COMPOSED" && crew !== "RELIEF") return result(ruleKey, "UNKNOWN", "composição conhecida", null, "Composição factual da tripulação indisponível.", "EXCEPTION");
  const max = ruleKey === "RBAC117_DUTY_EXTENSION" ? (crew === "SIMPLE" ? 60 : 120) : ruleKey === "RBAC117_FLIGHT_TIME_EXTENSION" ? (crew === "SIMPLE" ? 30 : 60) : 1;
  if (typeof extension !== "number") return result(ruleKey, "UNKNOWN", `${max} min`, null, "Valor factual da extensão indisponível.", "EXCEPTION");
  if (extension > max) return result(ruleKey, "FAIL", `${max}${ruleKey === "RBAC117_ADDITIONAL_LEG_EXTENSION" ? " leg" : " min"}`, extension, "Extensão comprovadamente acima do máximo permitido.", "EXCEPTION");
  if (unknown(circumstance) || unknown(commander)) return result(ruleKey, "UNKNOWN", `${max}`, extension, "Circunstância operacional ou decisão do comandante indisponível.", "EXCEPTION");
  if (!known(circumstance) || !known(commander)) return result(ruleKey, "NOT_APPLICABLE", `${max}`, extension, "Exceção indisponível para composição; não é violação independente.", "EXCEPTION");
  return result(ruleKey, "PASS", `${max}`, extension, "Exceção documentalmente confirmada.", "EXCEPTION");
}

export function evaluateRbacInDutyReprogramming(regime: unknown, facts: Record<string, unknown>, limitsWithin: unknown): RuleEvaluation {
  const gate = rbacGate("RBAC117_IN_DUTY_REPROGRAMMING", regime); if (gate) return gate;
  if (facts.reprogrammingDetected === "FALSE") return result("RBAC117_IN_DUTY_REPROGRAMMING", "NOT_APPLICABLE", "reprogramação após início", null, "Reprogramação não detectada.");
  if (facts.reprogrammingDetected !== "TRUE" || facts.reprogrammingAfterDutyStart === "UNKNOWN") return result("RBAC117_IN_DUTY_REPROGRAMMING", "UNKNOWN", "reprogramação após início", null, "Detecção ou momento factual da reprogramação indisponível.");
  if (facts.reprogrammingAfterDutyStart === "FALSE") return result("RBAC117_IN_DUTY_REPROGRAMMING", "NOT_APPLICABLE", "reprogramação após início", null, "Reprogramação documentada antes do início da duty.");
  if (facts.fitnessDeclaration === "FALSE") return result("RBAC117_IN_DUTY_REPROGRAMMING", "FAIL", "fitness declaration", null, "Declaração de aptidão documentada como falsa.");
  if (facts.fitnessDeclaration !== "TRUE" || limitsWithin !== true) return result("RBAC117_IN_DUTY_REPROGRAMMING", "UNKNOWN", "limites e fitness confirmados", null, "Fitness ou limites resultantes indisponíveis.");
  return result("RBAC117_IN_DUTY_REPROGRAMMING", "PASS", "limites e fitness confirmados", null, "Reprogramação após início com requisitos confirmados.");
}

export function evaluateRbacInterruptedDuty(regime: unknown, facts: Record<string, unknown>, dutyMinutes: number | null): RuleEvaluation {
  const gate = rbacGate("RBAC117_INTERRUPTED_DUTY_EXTENSION", regime); if (gate) return gate;
  if (facts.interruptedDutyDetected === "FALSE") return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "NOT_APPLICABLE", "interrupted duty", null, "Jornada interrompida não detectada.", "EXCEPTION");
  if (facts.interruptedDutyDetected !== "TRUE") return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "UNKNOWN", "interrupted duty", null, "Detecção factual indisponível.", "EXCEPTION");
  if (facts.historyComplete168h !== true || typeof facts.interruptedDutyCount168h !== "number") return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "UNKNOWN", "1 em 168 h", null, "Histórico factual de 168 horas incompleto.", "EXCEPTION");
  if (facts.interruptedDutyCount168h > 1 || facts.postInterruptionDutyMinutes === null || dutyMinutes === null) return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "FAIL", "1 em 168 h; pós 360 min; duty 840 min", typeof facts.interruptedDutyCount168h === "number" ? facts.interruptedDutyCount168h : null, "Limite factual de frequência ou duração comprovadamente excedido.", "EXCEPTION");
  if ((typeof facts.postInterruptionDutyMinutes === "number" && facts.postInterruptionDutyMinutes > 360) || dutyMinutes > 840) return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "FAIL", "pós 360 min; duty 840 min", dutyMinutes, "Limite factual de duração comprovadamente excedido.", "EXCEPTION");
  if (facts.dutyOutsideContractualBase !== "TRUE" || unknown(facts.accommodationType) || unknown(facts.restAccommodationConfirmed)) return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", "UNKNOWN", "accommodation e base confirmadas", null, "Base contratual ou accommodation necessária indisponível.", "EXCEPTION");
  const minutes = facts.interruptionMinutes; const touches = facts.interruptionTouches0000To0600 === "TRUE"; const caseOne = typeof minutes === "number" && minutes > 180 && minutes < 360 && !touches && facts.accommodationType === "RESERVE_TYPE"; const caseTwo = touches && typeof minutes === "number" && minutes >= 360 && facts.restAccommodationConfirmed === "TRUE"; const caseThree = typeof minutes === "number" && minutes >= 360 && minutes <= 600 && facts.restAccommodationConfirmed === "TRUE";
  return result("RBAC117_INTERRUPTED_DUTY_EXTENSION", caseOne || caseTwo || caseThree ? "PASS" : "FAIL", "casos RBAC interrupted duty", typeof minutes === "number" ? minutes : null, caseOne || caseTwo || caseThree ? "Caso documental permitido confirmado." : "Estrutura factual não atende aos casos permitidos.", "EXCEPTION");
}

export function evaluateDeadheadRule(ruleKey: string, facts: Record<string, unknown>, dutyMinutes: number | null): RuleEvaluation {
  const profile = facts.dutyTransportProfile;
  if (ruleKey === "LAW_DEADHEAD_WORK_TIME_CLASSIFICATION") return facts.deadheadCount && typeof facts.deadheadCount === "number" && facts.deadheadCount > 0 ? result(ruleKey, "PASS", "qualifier", null, "countsAsWorkTime=true; countsAsOperatingFlightTime=false.", "TRIGGER") : result(ruleKey, "NOT_APPLICABLE", "deadhead", null, "Não há deadhead na duty.");
  if (ruleKey === "GOL_DEADHEAD_ONLY_DOMESTIC_DUTY_LIMIT" || ruleKey === "GOL_DEADHEAD_ONLY_INTERNATIONAL_DUTY_LIMIT") { const required = ruleKey.includes("DOMESTIC") ? "DOMESTIC" : "INTERNATIONAL"; if (profile !== "DEADHEAD_ONLY" || facts.deadheadDomesticity !== required) return result(ruleKey, facts.deadheadDomesticity === "UNKNOWN" && profile === "DEADHEAD_ONLY" ? "UNKNOWN" : "NOT_APPLICABLE", required, dutyMinutes, "Perfil deadhead-only não aplicável ou incompleto."); if (dutyMinutes === null) return result(ruleKey,"UNKNOWN",required,null,"Duração factual indisponível."); const limit=required==="DOMESTIC"?720:960; return result(ruleKey,dutyMinutes<=limit?"PASS":"FAIL",`${limit} min`,dutyMinutes,"Limite de duty deadhead-only aplicado."); }
  if (ruleKey === "GOL_DEADHEAD_ONLY_INTERNATIONAL_14H_TRIGGER") { if (profile !== "DEADHEAD_ONLY" || facts.deadheadDomesticity !== "INTERNATIONAL") return result(ruleKey,"NOT_APPLICABLE","> 840 min",dutyMinutes,"Cenário internacional deadhead-only não aplicável."); if (dutyMinutes===null)return result(ruleKey,"UNKNOWN","> 840 min",null,"Duração indisponível."); return result(ruleKey,dutyMinutes>840&&dutyMinutes<=960?"PASS":"NOT_APPLICABLE","> 840 min",dutyMinutes,"Trigger internacional de 14 horas.","TRIGGER"); }
  if (ruleKey === "GOL_B737_CREW_REST_CLASS3_CLASSIFICATION") { const b737=Array.isArray(facts.aircraftCodes)&&facts.aircraftCodes.some((code)=>typeof code==="string"&&code.startsWith("B7")); return !b737?result(ruleKey,"NOT_APPLICABLE","B737 + couch",null,"Aeronave elegível não documentada."):result(ruleKey,"UNKNOWN","B737 + couch",null,"Crew Rest Couch indisponível; não inferido.","TRIGGER"); }
  if (ruleKey === "GOL_SDU_GROUP_CLASSIFICATION") return result(ruleKey,"NOT_APPLICABLE","grupo SDU",null,"Nenhuma rota SDU documental identificada.","TRIGGER");
  return result(ruleKey,"NOT_APPLICABLE","simulator/extra service",null,"Fato de simulador ou extra service não documentado.");
}

export function evaluateResidualRule(ruleKey: string, facts: Record<string, unknown>): RuleEvaluation {
  if (ruleKey === "LAW_GROUND_TRAINING_WORK_TIME_CLASSIFICATION") return facts.category === "GROUND_TRAINING" || facts.category === "ROUTE_EVALUATION" ? result(ruleKey,"PASS","qualifier",null,"countsAsWorkTime=true.","TRIGGER") : result(ruleKey,"NOT_APPLICABLE","ground training",null,"Evento não é treinamento em solo.");
  if (ruleKey === "LAW_SIMULATOR_WORK_TIME_CLASSIFICATION") return facts.category === "SIMULATOR" ? result(ruleKey,"PASS","qualifier",null,"countsAsWorkTime=true.","TRIGGER") : result(ruleKey,"NOT_APPLICABLE","simulator explícito",null,"Não há simulador documental.");
  if (ruleKey === "GOL_GROUND_TRAINING_NEXT_ACTIVITY_CLASSIFICATION") return facts.nextActivityType === "GROUND_TRAINING" ? result(ruleKey,"PASS","qualifier",null,"Ground training preservado como próxima atividade própria.","TRIGGER") : result(ruleKey,"NOT_APPLICABLE","ground training",null,"Próxima atividade não é treinamento em solo.");
  if (ruleKey === "GOL_SCHEDULE_PUBLICATION_MINIMUM_NOTICE") { if (typeof facts.periodStart !== "string" || typeof facts.publicationAt !== "string") return result(ruleKey,"UNKNOWN","5 dias",null,"Timestamp de publicação documental confiável indisponível."); const notice=Math.round((Date.parse(facts.periodStart)-Date.parse(facts.publicationAt))/60000); return result(ruleKey,notice>=7200?"PASS":"FAIL","5 dias",notice,"Antecedência documental de publicação."); }
  if (["GOL_INSTRUCTOR_DUTY_CLASSIFICATION","GOL_VACATION_PRE_REST_REQUIREMENT","GOL_VACATION_INTRUSION_POST_RETURN_REQUIREMENT","GOL_DIRECTED_SCHEDULE_CLASSIFICATION","GOL_SAL_CLASSIFICATION","GOL_PART_TIME_CLASSIFICATION"].includes(ruleKey)) return result(ruleKey,"NOT_APPLICABLE","fato documental explícito",null,"Cenário documental não identificado.");
  return result(ruleKey,"UNKNOWN","catálogo residual",null,"Cobertura documental requer revisão.");
}
