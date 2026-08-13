import assert from 'node:assert/strict';
import test from 'node:test';
import { parseFlightActivities } from './activity-parser';

test('interpreta atividades NetLine sem criar pernas de voo normais',()=>{
 const events=parseFlightActivities([{scheduleDate:'2026-08-02',rawText:'FR\nSOBREAVIS BSB 1330 1630\nC-EMG-ON BSB 1000 1300\nDH/G3 1411 BSB 1330 !1515 CGH\nC/I BSB 0745\nC/O !1420 RBR\nG3 1758 BSB 0835 !1000 RBR'}]);
 assert.deepEqual(events.map(event=>event.eventType),['OFF','STANDBY','COURSE','DEADHEAD','CHECK_IN','CHECK_OUT']);
 assert.equal(events[3].rawMetadata.outsideHomebaseTimezone,true);
 assert.equal(events[3].startTimeLocal,'13:30');
 assert.equal(events[3].endTimeLocal,'15:15');
 assert.equal(events[5].endTimeLocal,'14:20');
});

test('classifica DISP-DH como atividade de solo, nunca deadhead',()=>{
 const events=parseFlightActivities([{scheduleDate:'2026-08-02',rawText:'DISP-DH BSB 1310 1320'}],[{code:'DISP-DH',description:'DERRUBAR RESERVA',rawText:'DISP-DH  DERRUBAR RESERVA'}]);
 assert.equal(events[0].eventType,'GROUND_ACTIVITY');
 assert.equal(events[0].eventLabel,'DERRUBAR RESERVA');
 assert.equal(events[0].locationAirport,'BSB');
 assert.equal(events[0].startTimeLocal,'13:10');
 assert.equal(events[0].endTimeLocal,'13:20');
});
