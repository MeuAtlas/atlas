import assert from 'node:assert/strict';
import test from 'node:test';
import { activityDiagnosticText, buildActivityDiagnostic } from './activity-diagnostics';

test('produz diagnóstico determinístico e separa voo deferred de UNKNOWN',()=>{
 const events=[...Array.from({length:11},()=>({event_type:'OFF',event_code:'FR'})),...Array.from({length:4},()=>({event_type:'STANDBY',event_code:'SOBREAVIS'})),...Array.from({length:3},()=>({event_type:'COURSE',event_code:'C-EMG-ON'})),{event_type:'EVALUATION',event_code:'XQ-ROTA'},...Array.from({length:2},()=>({event_type:'DEADHEAD',event_code:'DH/G3'})),...Array.from({length:11},()=>({event_type:'CHECK_IN',event_code:'C/I'})),...Array.from({length:11},()=>({event_type:'CHECK_OUT',event_code:'C/O'}))];
 const diagnostic=buildActivityDiagnostic({importId:'planned',filename:'202608P.PDF',parserVersion:'netline-gol-parser/0.1.0',events,legends:[{code:'FR',description:'FOLGA REGULAMENTAR'}],days:[{schedule_date:'2026-08-05',raw_text:'G3 1758 BSB 0835 !1000 RBR'}]});
 assert.deepEqual(diagnostic.counts,{OFF:11,STANDBY:4,COURSE:3,EVALUATION:1,DEADHEAD:2,CHECK_IN:11,CHECK_OUT:11,GROUND_ACTIVITY:0,UNKNOWN:0});
 assert.equal(diagnostic.deferred,1);
 assert.match(activityDiagnosticText(diagnostic),/FR: 11/);
});

test('reprocessamentos equivalentes mantêm o mesmo conjunto lógico',()=>{
 const input={importId:'snapshot',filename:'22PDF.PDF',parserVersion:'netline-gol-parser/0.1.0',events:[{event_type:'GROUND_ACTIVITY',event_code:'DISP-DH'}],legends:[{code:'DISP-DH',description:'DERRUBAR RESERVA'}],days:[{schedule_date:'2026-08-02',raw_text:'DISP-DH BSB 1310 1320'}]};
 assert.deepEqual(buildActivityDiagnostic(input),buildActivityDiagnostic(input));
});

test('fixture de validação do Snapshot mantém as contagens reais isoladas',()=>{
 const events=[...Array.from({length:11},()=>({event_type:'OFF',event_code:'FR'})),...Array.from({length:4},()=>({event_type:'STANDBY',event_code:'SOBREAVIS'})),...Array.from({length:3},()=>({event_type:'COURSE',event_code:'C-EMG-ON'})),{event_type:'EVALUATION',event_code:'XQ-ROTA'},...Array.from({length:5},()=>({event_type:'DEADHEAD',event_code:'DH/G3'})),...Array.from({length:12},()=>({event_type:'CHECK_IN',event_code:'C/I'})),...Array.from({length:12},()=>({event_type:'CHECK_OUT',event_code:'C/O'})),...Array.from({length:3},()=>({event_type:'GROUND_ACTIVITY',event_code:'DISP-DH'}))];
 const diagnostic=buildActivityDiagnostic({importId:'snapshot',filename:'22PDF.PDF',parserVersion:'netline-gol-parser/0.1.0',events,legends:[{code:'DISP-DH',description:'DERRUBAR RESERVA'}],days:[]});
 assert.deepEqual(diagnostic.counts,{OFF:11,STANDBY:4,COURSE:3,EVALUATION:1,DEADHEAD:5,CHECK_IN:12,CHECK_OUT:12,GROUND_ACTIVITY:3,UNKNOWN:0});
});
