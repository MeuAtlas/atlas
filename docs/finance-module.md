# Módulo Financeiro

O Financeiro usa somente dados reais do Supabase. Não há seed de valores demonstrativos.

## Modelo e isolamento

- Toda conta, movimentação, cartão, compra, regra e conexão possui proprietário.
- Registros privados são visíveis apenas ao proprietário.
- Um item com visibilidade `workspace` exige workspace e respeita o papel do membro.
- Compartilhar uma movimentação não revela a conta privada vinculada: a política da conta continua independente.
- Transferências usam um único registro com origem e destino, atualizam os dois saldos atomicamente no banco e não entram em receitas ou despesas.
- Compra, fatura e conta bancária são entidades separadas, evitando duplicar a despesa quando uma fatura for paga.

## Aplicação

Use `npx supabase db push` para aplicar as migrations. Em projetos existentes, o backfill cria `Meu Atlas` e habilita o Financeiro para cada usuário.

Rotas funcionais: `/financeiro`, `/financeiro/movimentacoes`, `/financeiro/contas` e `/financeiro/cartoes`. Planejamento, relatórios e integrações começam com estrutura e estados vazios, sem dados fictícios.

O administrador pode suspender acesso e habilitar módulos de usuários ou workspaces. Ele não recebe, por esse papel, acesso às tabelas financeiras. Desabilitar um módulo nunca remove dados.

## Primeiro superadministrador

No SQL Editor do Supabase, use o UUID de um usuário existente. `system_user_roles` é a fonte autoritativa; `profiles.is_super_admin` é sincronizado e protegido:

```sql
insert into public.system_user_roles (user_id, role)
values ('UUID_DO_USUARIO', 'super_admin')
on conflict (user_id) do update
set role = 'super_admin', revoked_at = null, updated_at = now();
```

Essa operação nunca deve ser executada pelo navegador.
