alter table public.flight_fact_records drop constraint flight_fact_records_subject_type_check;
alter table public.flight_fact_records add constraint flight_fact_records_subject_type_check check(subject_type in('IMPORT','DAY','EVENT','DUTY','LEG','WINDOW','REST','OFF_PERIOD','OFF_PERIOD_MATCH','OFF_SUBSTITUTION','GROUND_INTERVAL','SCHEDULE_CHANGE','PROFILE','OPERATOR'));
