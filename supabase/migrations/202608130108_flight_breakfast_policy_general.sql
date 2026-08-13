-- Atlas Flight 3C.6: hotel usado fornece café; dispensa documental mantém o direito em qualquer localidade.
update public.flight_compensation_profile_policies p
set metadata = jsonb_set(coalesce(p.metadata,'{}'::jsonb), '{defaultHotelUsed}', 'true'::jsonb, true),
    source_reference='Policy geral confirmada: hotel usado inclui café; dispensa documentada mantém café elegível em qualquer localidade.', updated_at=now()
from public.flight_compensation_profiles profile
where p.profile_id=profile.id and p.policy_key='HOTEL_USAGE_POLICY' and profile.contractual_base='BSB';
