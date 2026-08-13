alter table public.flight_financial_segments drop constraint if exists flight_financial_segments_activity_type_check;
alter table public.flight_financial_segments add constraint flight_financial_segments_activity_type_check check(activity_type in ('OPERATING','DEADHEAD','STANDBY','RESERVE'));
alter table public.flight_financial_segments drop constraint if exists flight_financial_segments_subject_type_check;
alter table public.flight_financial_segments add constraint flight_financial_segments_subject_type_check check(subject_type in ('LEG','EVENT'));
alter table public.flight_financial_segments drop constraint if exists flight_financial_segments_reference_timezone_check;
alter table public.flight_financial_segments add constraint flight_financial_segments_reference_timezone_check check(reference_timezone in ('UTC','LOCAL'));
