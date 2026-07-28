# Atlas

Aplicação pessoal privada construída com Next.js 16 App Router e Supabase.

## Variáveis de ambiente

Configure localmente em `.env.local` e, em produção, nas variáveis do projeto Vercel:

```bash
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=...
```

Não use `SUPABASE_SERVICE_ROLE_KEY` no navegador nem em variáveis `NEXT_PUBLIC_*`.

## Banco e migrations

As migrations versionadas estão em `supabase/migrations`:

1. `202607210001_create_profiles.sql`
2. `202607210002_create_families.sql`
3. `202607210003_family_functions_and_rls.sql`
4. `202607210004_create_system_user_roles.sql`
5. `202607220005_create_modular_core.sql`
6. `202607220006_create_finance.sql`
7. `202607220007_harden_user_provisioning.sql`

Com o Supabase CLI instalado e o projeto vinculado:

```bash
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push
```

Para um ambiente Supabase local:

```bash
npx supabase start
npx supabase db reset
```

As migrations criam tabelas, índices, triggers, RLS e as RPCs familiares, além das funções `is_super_admin` e `get_my_system_role` para autorização global baseada exclusivamente na sessão atual.

## URLs do Supabase Auth

Em **Authentication > URL Configuration**, configure o domínio principal e inclua nas Redirect URLs:

```text
http://localhost:3000/auth/callback
https://SEU-DOMINIO/auth/callback
```

Em **Authentication > Providers > Email**, desative a criação pública de novos usuários. As contas autorizadas devem ser criadas somente por um administrador em **Authentication > Users**.

## Contas iniciais

Não existe cadastro público e nenhuma credencial fica no repositório. Para criar as duas contas iniciais:

1. Abra o projeto no Supabase.
2. Acesse **Authentication > Users**.
3. Crie cada conta com um e-mail real diferente.
4. Defina uma senha temporária forte.
5. Confirme o e-mail conforme a configuração do projeto.
6. Entre separadamente em cada conta.
7. Conclua o onboarding individual de cada usuário.

Família não é obrigatória e não concede acesso aos dados pessoais da outra conta.

## Tipos do Supabase

Os tipos de domínio usados pela aplicação estão em `src/types/atlas.ts`. Depois de aplicar migrations, tipos completos podem ser regenerados com:

```bash
npx supabase gen types typescript --linked > src/types/database.generated.ts
```

## Desenvolvimento

O runtime oficial do Atlas é o Node.js 22 LTS, definido em `.nvmrc` e em
`package.json`. Configure também a versão 22 no projeto da Vercel e no CI antes
de instalar dependências:

```bash
nvm use
node -v
```

```bash
npm install
npm run dev
```

Para testar em um celular conectado a mesma rede local, exponha o servidor em todas as interfaces:

```bash
npm run dev -- -H 0.0.0.0
```

No celular, acesse:

```text
http://IP_DO_COMPUTADOR:3000/login
```

`localhost` no celular aponta para o proprio aparelho, nao para o computador que executa o Atlas.

Verificações:

```bash
npm run lint
npm run typecheck
npm run build
npm test
node scripts/test-pdf-extraction.mjs
```

Consulte [docs/architecture.md](docs/architecture.md) para as decisões de privacidade, isolamento e família e [docs/auth-test-plan.md](docs/auth-test-plan.md) para o roteiro de validação com duas contas.

## Integração Pluggy

Configure `PLUGGY_CLIENT_ID` e `PLUGGY_CLIENT_SECRET` somente no ambiente do servidor (Vercel Preview/Production). Não use o prefixo `NEXT_PUBLIC_`. Depois de aplicar as migrations do Supabase, acesse **Financeiro → Integrações**, valide as credenciais e informe o Item ID exibido no Pluggy Dashboard.

Para o endpoint `POST /api/pluggy/webhook`, configure também
`PLUGGY_WEBHOOK_SECRET` e `SUPABASE_SERVICE_ROLE_KEY` somente no servidor.
Cadastre na Pluggy o mesmo segredo no header `X-Atlas-Webhook-Secret`. O
endpoint registra `eventId` de forma idempotente e responde antes de processar
a sincronização.

A Pluggy não oferece um endpoint para listar Items existentes por motivos de segurança. Por isso, o Atlas não tenta adivinhar nem fixa o Item ID: ele valida no backend o identificador informado e o associa ao usuário autenticado. A sincronização é manual, idempotente e os dados importados permanecem privados por padrão.

O bootstrap manual e as regras da administração global estão em [docs/system-administration.md](docs/system-administration.md).
