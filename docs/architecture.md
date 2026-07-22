# Arquitetura de identidade e privacidade do Atlas

## Princípio fundamental

Cada conta possui um Atlas pessoal, privado e independente. `auth.users.id` é a identidade canônica e `public.profiles.id` usa exatamente o mesmo UUID. O e-mail permanece sob responsabilidade do Supabase Auth.

Pertencer a uma família não altera policies de dados pessoais. Família é somente um vínculo entre contas. Os módulos pessoais futuros (`financial_accounts`, `documents`, `tasks`, `calendar_items`, `assets` e equivalentes) devem possuir `owner_id uuid not null references auth.users(id)` e policies baseadas em `owner_id = auth.uid()`.

Compartilhamento será explícito e seletivo por recurso, em uma estrutura futura como `resource_shares`. Não se deve adicionar `family_id` a tabelas pessoais como atalho de autorização.

## Camadas de segurança

1. O `proxy.ts` atualiza cookies e impede acesso anônimo às rotas privadas.
2. Server Components confirmam o usuário com `supabase.auth.getUser()` e decidem onboarding antes de renderizar conteúdo.
3. RLS no PostgreSQL é a autorização definitiva, inclusive para chamadas diretas à API do Supabase.
4. RPCs `security definer` executam operações familiares transacionais e usam `search_path` vazio, validação de `auth.uid()` e grants mínimos.

## Administração global

- `system_user_roles` é independente de `profiles` e de `family_members`.
- O cliente não possui privilégios de leitura ou escrita nessa tabela.
- `is_super_admin()` e `get_my_system_role()` revelam somente o cargo da própria sessão autenticada, usando `auth.uid()` sem parâmetros fornecidos pelo cliente.
- O link administrativo é condicional, mas `/admin` sempre repete a autorização no servidor.
- Ser `super_admin` não modifica nenhuma policy pessoal e não implica participação ou papel em uma família.
- A futura auditoria administrativa está detalhada em `docs/system-administration.md`.

## Famílias

- `families`: identidade e nome do agrupamento.
- `family_members`: vínculo, papel e estado do membro.
- `family_invitations`: convite, expiração e transições de estado; eventual token é armazenado somente como hash.
- Um índice parcial limita cada usuário a uma única família ativa nesta versão.
- `owner` administra `admin` e `member`; `admin` não altera owner e só administra member.
- O único owner ativo não pode sair.

## Fluxo de autenticação

1. Login usa `signInWithPassword` no cliente browser do `@supabase/ssr`.
2. A sessão é persistida em cookies e renovada pelo proxy.
3. `/dashboard` consulta ou cria o perfil sob RLS.
4. Perfil incompleto redireciona no servidor para `/onboarding`.
5. Perfil concluído acessa `/dashboard`.
6. Logout usa `signOut`, remove a sessão e retorna para `/login`.
