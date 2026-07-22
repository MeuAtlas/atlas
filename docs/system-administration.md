# Administração global do Atlas

## Separação de responsabilidades

`system_user_roles` representa cargos operacionais globais do Atlas. Ela não substitui `profiles`, não participa de `family_members` e não altera as policies das tabelas pessoais.

Na navegação normal, mesmo um `super_admin` continua sujeito a `owner_id = auth.uid()`. Uma futura exceção administrativa deverá existir somente no servidor, exigir justificativa e produzir um registro em `system_audit_logs`.

## Bootstrap do primeiro super administrador

1. Crie a conta autorizada em **Supabase > Authentication > Users**.
2. Copie o UUID dessa conta.
3. Abra o **SQL Editor** usando uma sessão administrativa.
4. Substitua os dois marcadores abaixo e execute:

```sql
insert into public.system_user_roles (
  user_id,
  role,
  granted_by
)
values (
  '<UUID_DO_USUARIO>',
  'super_admin',
  '<UUID_DO_USUARIO>'
)
on conflict (user_id)
do update set
  role = excluded.role,
  granted_by = excluded.granted_by,
  granted_at = now(),
  revoked_at = null,
  updated_at = now();
```

Nenhum e-mail, senha ou UUID real deve ser versionado. Para revogar o acesso sem apagar o histórico, preencha `revoked_at` pelo SQL Editor administrativo.

## Auditoria futura

`system_audit_logs` deverá registrar administrador, ação, recurso, data, IP ou contexto disponível, justificativa e resultado. Operações excepcionais sobre dados ou contas deverão falhar se não puderem registrar a auditoria.

Se a administração futura precisar da chave `service_role`, use um cliente separado importável apenas por Server Actions ou Route Handlers. A variável não pode possuir o prefixo `NEXT_PUBLIC_` e nunca pode fazer parte de bundles do navegador.
