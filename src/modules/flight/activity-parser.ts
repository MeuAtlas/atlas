export type FlightActivityType = 'OFF'|'STANDBY'|'COURSE'|'TRAINING'|'EVALUATION'|'DEADHEAD'|'CHECK_IN'|'CHECK_OUT'|'GROUND_ACTIVITY'|'UNKNOWN';
export type ParsedFlightEvent = { scheduleDate:string; eventType:FlightActivityType; eventCode:string; eventLabel:string|null; sequence:number; startTimeLocal:string|null; endTimeLocal:string|null; locationAirport:string|null; rawText:string; rawMetadata:Record<string,unknown>; confidence:'HIGH'|'MEDIUM'|'LOW' };
export type ParsedFlightLegend = { code:string; description:string|null; rawText:string };

function time(value:string|undefined) { if (!value) return null; const raw=value.replace('!',''); return /^\d{4}$/.test(raw)?`${raw.slice(0,2)}:${raw.slice(2)}`:null; }
function fields(line:string) { const airport=line.match(/\b[A-Z]{3}\b/); const times=[...line.matchAll(/!?\d{4}/g)].map(match=>match[0]); return { airport:airport?.[0]??null,times }; }
export function parseFlightLegends(documentText:string) {
  const start=documentText.search(/Absence\/Ground\s+Activity\s+Legend/i); if(start<0)return [] as ParsedFlightLegend[];
  const lines=documentText.slice(start).split(/\r?\n/); const legends:ParsedFlightLegend[]=[];
  for(const rawText of lines.slice(1)){const line=rawText.trim(); if(!line)continue; const match=line.match(/^([A-Z][A-Z0-9\/-]{1,})\s{2,}(.+)$/); if(match && !/^code\s+description$/i.test(line))legends.push({code:match[1],description:match[2].trim()||null,rawText:line});}
  return [...new Map(legends.map(item=>[item.code,item])).values()];
}
export function parseFlightActivities(days:Array<{scheduleDate:string;rawText:string}>, legends:ParsedFlightLegend[]=[]) {
  const events:ParsedFlightEvent[]=[];
  const labels=new Map(legends.filter(item=>item.description).map(item=>[item.code,item.description]));
  for (const day of days) { let sequence=0; for (const rawText of day.rawText.split(/\r?\n/)) { const line=rawText.trim(); if (!line) continue; const add=(eventType:FlightActivityType,eventCode:string,confidence:ParsedFlightEvent['confidence'], extra:Partial<ParsedFlightEvent>={})=>events.push({scheduleDate:day.scheduleDate,eventType,eventCode,eventLabel:null,sequence:++sequence,startTimeLocal:null,endTimeLocal:null,locationAirport:null,rawText:line,rawMetadata:{},confidence,...extra}); const data=fields(line);
      if (/\bFR\b/.test(line)) add('OFF','FR','HIGH');
      else if (/\bSOBREAVIS\b/.test(line)) add('STANDBY','SOBREAVIS','HIGH',{locationAirport:data.airport,startTimeLocal:time(data.times[0]),endTimeLocal:time(data.times[1])});
      else if (/\bXQ-ROTA\b/.test(line)) add('EVALUATION','XQ-ROTA','HIGH');
      else if (/\bDISP-DH\b/.test(line)) add('GROUND_ACTIVITY','DISP-DH','HIGH',{locationAirport:data.airport,startTimeLocal:time(data.times[0]),endTimeLocal:time(data.times[1]),rawMetadata:{rawTimes:data.times,outsideHomebaseTimezone:data.times.some(value=>value.startsWith('!'))}});
      else if (/\bDH\/G3\b/.test(line)) { const flight=line.match(/DH\/G3\s+(\d+)/)?.[1]??null; const flightTimes=data.times.slice(1); add('DEADHEAD','DH/G3','HIGH',{locationAirport:data.airport,startTimeLocal:time(flightTimes[0]),endTimeLocal:time(flightTimes[1]),rawMetadata:{flightNumber:flight,rawTimes:flightTimes,outsideHomebaseTimezone:flightTimes.some(value=>value.startsWith('!'))}}); }
      else if (/\bC\/I\b/.test(line)) add('CHECK_IN','C/I','HIGH',{locationAirport:data.airport,startTimeLocal:time(data.times[0]),rawMetadata:{rawTime:data.times[0]??null,outsideHomebaseTimezone:Boolean(data.times[0]?.startsWith('!'))}});
      else if (/\bC\/O\b/.test(line)) add('CHECK_OUT','C/O','HIGH',{locationAirport:data.airport,endTimeLocal:time(data.times[0]),rawMetadata:{rawTime:data.times[0]??null,outsideHomebaseTimezone:Boolean(data.times[0]?.startsWith('!'))}});
      else { const course=line.match(/\b(C-[A-Z0-9-]+)\b/); if(course) add('COURSE',course[1],'MEDIUM',{locationAirport:data.airport,startTimeLocal:time(data.times[0]),endTimeLocal:time(data.times[1])}); }
    } }
  return events.map(event=>({...event,eventLabel:labels.get(event.eventCode)??event.eventLabel}));
}
