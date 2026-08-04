# Validação do PWA Atlas

## Estado desta implementação

A implementação foi validada localmente com o build de produção do Next.js. A certificação final de instalação exige uma implantação HTTPS e dispositivos reais; ela não deve ser substituída por testes em `localhost`.

## Segurança do cache

O service worker usa rede para toda navegação e nunca persiste páginas autenticadas. Somente estes recursos públicos podem entrar no cache `atlas-pwa-*-static`:

- `/_next/static/`;
- `/icons/`;
- `/assets/atlas/`;
- `/login/`;
- CSS, JavaScript versionado, fontes e imagens públicas.

Não entram no cache: `/api/`, `/financeiro`, Supabase, Pluggy, relatórios, PDFs, documentos, respostas com sessão ou ações de escrita.

## iPhone e iPad

1. Publicar o build em HTTPS e abrir o domínio no Safari.
2. Entrar no Atlas e abrir **Meu Atlas**.
3. Tocar em **Instalar Atlas**.
4. No Safari, tocar em **Compartilhar** e **Adicionar à Tela de Início**.
5. Confirmar o ícone e abrir o Atlas por ele.
6. Confirmar modo sem barra do Safari, tema, status bar e áreas do notch/Dynamic Island.
7. Navegar por Financeiro, Movimentações, Contas, Cartões, Relatórios e Integrações.
8. Fechar e reabrir, confirmando que a sessão continua válida.
9. Desativar a rede e abrir uma nova rota: deve aparecer a mensagem segura de indisponibilidade, sem saldos antigos.
10. Reativar a rede e confirmar a recuperação.
11. Testar tema claro, escuro, retrato, paisagem e texto ampliado.

## Android

1. Abrir o domínio HTTPS no Chrome.
2. Usar **Instalar Atlas** e aceitar o prompt.
3. Abrir pelo ícone e confirmar `standalone`, tema e navegação.
4. Repetir o teste offline e de recuperação.
5. Publicar uma versão com `ATLAS_SW_VERSION` incrementada e confirmar o aviso de atualização.

## Windows e macOS

1. Abrir o domínio HTTPS em Chrome ou Edge; no macOS, testar também Safari compatível.
2. Instalar pelo botão do Atlas ou do navegador.
3. Confirmar janela independente, ícone, deep links, voltar, login e logout.
4. Repetir os testes de atualização e offline.

## Atualização

1. Instalar a versão atual.
2. Alterar `ATLAS_SW_VERSION` em `public/sw.js`, gerar e publicar um novo build.
3. Reabrir o Atlas e aguardar o aviso **Nova versão disponível**.
4. Confirmar que **Depois** fecha o aviso sem recarregar.
5. Confirmar que **Atualizar agora** ativa o worker e recarrega uma única vez na mesma rota.
6. Repetir durante upload de PDF ou edição protegida; o Atlas deve pedir para concluir a ação primeiro.

## Auditoria de produção

- Confirmar `200` e `application/manifest+json` em `/manifest.webmanifest`.
- Confirmar `200`, `application/javascript; charset=utf-8`, `no-cache, no-store, must-revalidate` e `Service-Worker-Allowed: /` em `/sw.js`.
- Executar a auditoria PWA atual do Chrome DevTools/Lighthouse no domínio HTTPS.
- Em DevTools > Application > Cache Storage, confirmar que não existem URLs de Supabase, Pluggy, `/api/`, `/financeiro`, relatórios, PDFs ou documentos.
- Em Application > Manifest, confirmar ícones 192/512 e variantes maskable.
- Em Application > Service Workers, confirmar worker ativo, escopo `/` e fallback offline.
