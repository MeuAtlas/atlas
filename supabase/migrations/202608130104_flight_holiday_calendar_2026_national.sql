-- 3C.3A: fonte operacional local para feriados nacionais de 2026; bases permanecem pendentes de fonte oficial.
alter table public.flight_holiday_calendar_years drop constraint if exists flight_holiday_calendar_years_status_check;
alter table public.flight_holiday_calendar_years add constraint flight_holiday_calendar_years_status_check check(status in ('VERIFIED','PENDING_VERIFICATION','PARTIALLY_VERIFIED','INCOMPLETE','UNKNOWN'));
alter table public.flight_holidays add column if not exists source_url text, add column if not exists verification_status text not null default 'VERIFIED' check(verification_status in ('VERIFIED','PENDING_VERIFICATION','REJECTED')), add column if not exists effective_from date, add column if not exists effective_to date, add column if not exists notes text;
update public.flight_holiday_calendar_years set status='PARTIALLY_VERIFIED',source_reference='Feriados nacionais 2026 verificados; bases RIO, POA, SAO, GRU, BSB e FOR aguardam fontes locais oficiais.' where year=2026 and country='BR' and base_code is null;
insert into public.flight_holiday_calendar_years(year,country,base_code,status,source_reference) values
 (2026,'BR','RIO','PENDING_VERIFICATION','Aguardando fontes oficiais RJ/Rio de Janeiro.'),
 (2026,'BR','POA','PENDING_VERIFICATION','Aguardando fontes oficiais RS/Porto Alegre.'),
 (2026,'BR','SAO','PENDING_VERIFICATION','Aguardando fontes oficiais SP/São Paulo.'),
 (2026,'BR','GRU','PENDING_VERIFICATION','Aguardando fontes oficiais SP/Guarulhos.'),
 (2026,'BR','BSB','PENDING_VERIFICATION','Aguardando fontes oficiais DF/Brasília.'),
 (2026,'BR','FOR','PENDING_VERIFICATION','Aguardando fontes oficiais CE/Fortaleza.')
on conflict (year,country,base_code) do update set status=excluded.status,source_reference=excluded.source_reference;
insert into public.flight_holidays(holiday_date,name,scope,country,year,legal_source_type,legal_source_number,legal_source_issuer,legal_source_reference,source_url,verified,verification_status,lifecycle,notes) values
 ('2026-01-01','Confraternização Universal','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-04-21','Tiradentes','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-05-01','Dia Mundial do Trabalho','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-09-07','Independência do Brasil','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-10-12','Nossa Senhora Aparecida','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 6.802/1980','Presidência da República','Lei 6.802/1980.','https://www.planalto.gov.br/ccivil_03/leis/l6802.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-11-02','Finados','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-11-15','Proclamação da República','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-11-20','Dia Nacional de Zumbi e da Consciência Negra','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 14.759/2023','Presidência da República','Lei 14.759/2023.','https://www.planalto.gov.br/ccivil_03/_ato2023-2026/2023/lei/l14759.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.'),
 ('2026-12-25','Natal','NATIONAL','BR',2026,'FEDERAL_LAW','Lei 662/1949, art. 1º','Presidência da República','Lei 662/1949 com redação da Lei 10.607/2002.','https://www.planalto.gov.br/ccivil_03/leis/l0662.htm',true,'VERIFIED','REVIEWED','Não é ponto facultativo.')
on conflict (holiday_date,scope,base_code,name) do update set legal_source_reference=excluded.legal_source_reference,source_url=excluded.source_url,verified=true,verification_status='VERIFIED',lifecycle='REVIEWED',notes=excluded.notes;
