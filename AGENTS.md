<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

## Navegação interna de consultas

- Filtros, pesquisas, paginação e seletores de período internos devem preservar o shell e atualizar somente o payload da rota pelo App Router.
- Use `ClientSearchForm` em formulários GET e `useClientNavigation` em seletores ou fluxos imperativos.
- Não use `window.location.assign`, `window.location.replace` ou `window.location.reload` para rotas internas.
- Preserve os filtros na query string, use caminhos relativos seguros e mantenha a rolagem com `scroll: false`.
- Toda navegação interna que busca novos dados deve usar a transição rastreada do padrão para exibir o feedback global de carregamento.
- Links globais entre rotas autenticadas dinâmicas devem usar `prefetch={false}` para não executar consultas financeiras em segundo plano; a rota atual deve ser texto, não link para si própria.
