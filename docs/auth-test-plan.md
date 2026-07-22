# Validação de autenticação e RLS

Execute este roteiro em um projeto de teste depois de aplicar as migrations. Use duas contas criadas no painel do Supabase e nunca registre as credenciais no repositório.

## Fluxos da aplicação

1. Sem cookies, abra `/dashboard`, `/onboarding` e `/settings/family`: todas devem redirecionar para `/login`.
2. Entre com a conta A ainda não configurada: o destino deve ser `/onboarding` e o respectivo `profiles.id` deve ser igual ao `auth.users.id`.
3. Envie o onboarding sem nome completo e confirme a validação; depois conclua com dados válidos e confirme o redirecionamento para `/dashboard`.
4. Atualize a página e faça um novo login: a conta configurada deve ir diretamente para `/dashboard`.
5. Faça logout e confirme que uma rota privada volta a redirecionar para `/login`.
6. Confirme que o tema, a recuperação de senha e o console do navegador continuam sem erros.

## Isolamento de perfis

Com o JWT da conta A, tente via cliente Supabase:

- selecionar `profiles` pelo UUID da conta B;
- atualizar `profiles` pelo UUID da conta B;
- excluir qualquer `profiles`.

As duas primeiras operações não devem retornar nem alterar linhas; a exclusão deve ser negada. Repita invertendo A e B.

## Família e hierarquia

1. Chame `create_family` como A e confirme, na mesma transação lógica, a família e o membership ativo de A como `owner`.
2. Tente chamar `create_family` novamente como A: deve retornar `ALREADY_IN_ACTIVE_FAMILY`.
3. Crie um convite válido para B e aceite como B; confirme membership e convite `accepted` com `accepted_at` e `invited_user_id`.
4. Tente aceitar novamente, aceitar convite expirado e aceitar um convite destinado a outra conta; nenhum caso deve criar membership.
5. Como `member`, tente inserir/alterar membros e atualizar a família: deve ser negado.
6. Como `admin`, tente remover ou alterar o `owner`: deve ser negado.
7. Como único `owner`, chame `leave_family`: deve retornar `ONLY_OWNER_CANNOT_LEAVE`.
8. Tente inserir/atualizar diretamente linhas para contornar as RPCs e tente excluir fisicamente família, membro ou convite: os grants, policies e triggers devem negar as operações indevidas.
9. Como membros da mesma família, confirme que A e B veem a estrutura familiar permitida, mas continuam sem ler ou alterar o `profile` um do outro.

As futuras tabelas pessoais devem repetir o teste cruzado usando `owner_id = auth.uid()`. Membership familiar nunca deve participar dessa policy.

## Administração global

1. Sem sessão, abra `/admin` e confirme o redirecionamento para `/login`.
2. Com uma conta comum, abra `/admin` diretamente e confirme o redirecionamento para `/dashboard`.
3. Confirme que a conta comum não vê o link “Administração”.
4. Tente selecionar, inserir, atualizar e excluir `system_user_roles` com um JWT comum: todas as operações diretas devem ser negadas.
5. Confirme que `is_super_admin()` retorna `false` e `get_my_system_role()` retorna `null` para a conta comum.
6. Faça o bootstrap administrativo conforme a documentação e confirme que apenas essa conta recebe `true` e acessa `/admin`.
7. Preencha `revoked_at` administrativamente, renove a página e confirme que o link desaparece e `/admin` volta a redirecionar.
8. Mesmo como `super_admin`, repita os testes cruzados de `profiles` e de futuras tabelas com `owner_id`: o acesso aos dados da outra conta deve continuar bloqueado.
