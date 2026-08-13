export const activityTypes = ['OFF','STANDBY','COURSE','EVALUATION','DEADHEAD','CHECK_IN','CHECK_OUT','GROUND_ACTIVITY','UNKNOWN'] as const;
export type ActivityType = typeof activityTypes[number];
export type DiagnosticEvent = { event_type: string; event_code: string };
export type DiagnosticLegend = { code: string; description: string | null };
export type DiagnosticDay = { schedule_date: string; raw_text: string };
export type DiagnosticLeg = { leg_type: 'OPERATING'|'DEADHEAD'; duty_id: string|null; duty_link_status: 'LINKED'|'UNLINKED_DOCUMENT_NO_CI_CO'|'UNLINKED_AMBIGUOUS' };
export type DiagnosticDuty = { status: 'COMPLETE'|'OPEN'|'AMBIGUOUS' };
export function buildActivityDiagnostic(input:{ importId:string; filename:string; parserVersion:string|null; events:DiagnosticEvent[]; legends:DiagnosticLegend[]; days:DiagnosticDay[]; legs?:DiagnosticLeg[]; duties?:DiagnosticDuty[] }) {
  const counts=Object.fromEntries(activityTypes.map(type=>[type,0])) as Record<ActivityType,number>;
  const eventCodes:Record<string,number>={};
  for(const event of input.events){ if(event.event_type in counts) counts[event.event_type as ActivityType]+=1; eventCodes[event.event_code]=(eventCodes[event.event_code]??0)+1; }
  const deferred=input.days.reduce((total,day)=>total+day.raw_text.split(/\r?\n/).filter(line=>/^\s*G3\s+\d+\b/.test(line)).length,0);
  const legs=input.legs??[]; const duties=input.duties??[];
  const structure={duties:duties.length,operating:legs.filter(leg=>leg.leg_type==='OPERATING').length,deadhead:legs.filter(leg=>leg.leg_type==='DEADHEAD').length,total:legs.length,open:duties.filter(duty=>duty.status==='OPEN').length,ambiguous:duties.filter(duty=>duty.status==='AMBIGUOUS').length,linkedLegs:legs.filter(leg=>leg.duty_link_status==='LINKED').length,unlinkedDocumental:legs.filter(leg=>leg.duty_link_status==='UNLINKED_DOCUMENT_NO_CI_CO').length,unlinkedAmbiguous:legs.filter(leg=>leg.duty_link_status==='UNLINKED_AMBIGUOUS').length};
  return { importId:input.importId,filename:input.filename,parserVersion:input.parserVersion,counts,eventCodes,legends:input.legends,days:input.days,deferred,structure };
}
export function activityDiagnosticText(diagnostic:ReturnType<typeof buildActivityDiagnostic>) { const counts=activityTypes.map(type=>`${type}: ${diagnostic.counts[type]}`).join('\n'); const codes=Object.entries(diagnostic.eventCodes).sort(([a],[b])=>a.localeCompare(b)).map(([code,count])=>`${code}: ${count}`).join('\n'); const legends=diagnostic.legends.map(item=>`${item.code} = ${item.description??'Sem descrição identificada'}`).join('\n'); const structure=[`DUTIES: ${diagnostic.structure.duties}`,`OPERATING: ${diagnostic.structure.operating}`,`DEADHEAD: ${diagnostic.structure.deadhead}`,`TOTAL: ${diagnostic.structure.total}`,`OPEN: ${diagnostic.structure.open}`,`AMBIGUOUS: ${diagnostic.structure.ambiguous}`,`LINKED LEGS: ${diagnostic.structure.linkedLegs}`,`UNLINKED DOCUMENTAL: ${diagnostic.structure.unlinkedDocumental}`,`UNLINKED AMBIGUOUS: ${diagnostic.structure.unlinkedAmbiguous}`].join('\n'); return `${diagnostic.filename}\nParser: ${diagnostic.parserVersion??'Pendente'}\n\n${counts}\nDEFERRED: ${diagnostic.deferred}\n\nDUTIES E LEGS\n${structure}\n\nEVENT CODES\n${codes||'Nenhum'}\n\nLEGENDA\n${legends||'Nenhuma'}`; }
