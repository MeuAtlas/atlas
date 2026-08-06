<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

# Atlas — instruções para agentes

Este arquivo contém apenas regras globais e permanentes do repositório.

Especificações próprias de uma tela, cálculo ou funcionalidade devem vir na tarefa atual ou na documentação específica correspondente.

Quando existir um `AGENTS.md` mais próximo dos arquivos alterados, siga também suas instruções.

## 1. Antes de alterar

Antes de escrever código:

1. leia integralmente a solicitação;
2. inspecione a implementação atual;
3. localize rotas, componentes, consultas, tipos, migrations e testes relacionados;
4. confira os scripts disponíveis em `package.json`;
5. confirme os nomes reais de arquivos, tabelas, campos e relacionamentos;
6. consulte a documentação da versão instalada quando houver dúvida.

Não presuma a estrutura do projeto somente pela descrição da tarefa.

Não crie implementação paralela quando já existir estrutura reutilizável.

## 2. Escopo

Faça a menor alteração coerente que resolva completamente a tarefa.

Evite:

- refatorações não solicitadas;
- alterações fora da área afetada;
- renomeações amplas;
- duplicação de componentes, serviços ou regras;
- troca ou instalação de bibliotecas sem necessidade;
- abstrações sem uso real;
- alterações destrutivas de dados.

Quando uma mudança adicional for indispensável, mantenha-a limitada e explique o motivo na entrega.

## 3. Next.js e navegação interna

Use somente APIs compatíveis com as versões instaladas.

Para tarefas relacionadas ao Next.js, leia a documentação aplicável em `node_modules/next/dist/docs/`.

- Filtros, pesquisas, paginação e seletores de período devem preservar o shell e atualizar somente o payload da rota pelo App Router.
- Use `ClientSearchForm` em formulários GET.
- Use `useClientNavigation` em seletores e fluxos imperativos.
- Não use `window.location.assign`, `window.location.replace` ou `window.location.reload` para rotas internas.
- Preserve filtros e estado relevante na query string.
- Use caminhos relativos seguros.
- Use `scroll: false` quando aplicável.
- Navegações que buscam novos dados devem usar a transição rastreada para exibir o carregamento global.
- Links globais entre rotas autenticadas dinâmicas devem usar `prefetch={false}`.
- A rota atual deve ser texto, não link para si própria.
- Abrir ou fechar detalhes não deve apagar espaço, período, pesquisa, filtros ou ordenação.

## 4. Server e Client Components

Prefira Server Components quando não houver necessidade real de estado, efeitos, eventos ou APIs do navegador.

Não adicione `"use client"` a páginas ou árvores inteiras para resolver uma interação localizada.

Mantenha Client Components pequenos e próximos da interação.

Consultas e dados sensíveis devem permanecer no servidor sempre que possível.

## 5. TypeScript

- Não use `any`.
- Não use `@ts-ignore` para esconder erros.
- Reutilize tipos existentes.
- Prefira tipos derivados das fontes reais.
- Trate explicitamente valores nulos, opcionais e desconhecidos.
- Evite coerções inseguras.
- Mantenha banco, servidor e cliente consistentes.
- Atualize os tipos quando mudanças de schema exigirem.

Corrija erros de tipagem na origem, em vez de silenciá-los.

## 6. Supabase, segurança e isolamento

Antes de alterar consultas ou schema:

1. verifique tabelas e relacionamentos existentes;
2. confira autenticação, propriedade e workspace;
3. confira as políticas de RLS;
4. avalie o impacto sobre dados existentes.

Regras obrigatórias:

- não exponha chaves de serviço no cliente;
- não remova nem enfraqueça RLS;
- não permita acesso cruzado entre usuários ou workspaces;
- não confie somente em filtros do cliente para proteger dados;
- não edite migrations históricas aplicadas;
- use migrations versionadas para mudanças de schema;
- preserve dados existentes;
- não invente dados em migrations;
- não exponha informações sensíveis em logs ou mensagens de erro.

## 7. Regras financeiras permanentes

- Pagamento de cartão não é receita.
- Pagamento de fatura não deve duplicar as compras contabilizadas.
- Transferências internas não devem inflar entradas ou saídas econômicas.
- Compra no cartão e saída da conta são eventos distintos.
- Desconto em folha não deve criar saída fictícia na conta corrente.
- Cada evento econômico deve ser contabilizado no máximo uma vez.
- Compras parceladas não podem aparecer novamente como compras comuns.
- Estornos e reembolsos devem conservar sua natureza econômica correta.
- O sinal recebido por uma integração não define sozinho a natureza da transação.
- Valores exibidos devem ser rastreáveis até sua origem.
- Divergências e dados incompletos não devem ser escondidos ou inventados.
- Cálculos compartilhados devem ficar centralizados e reutilizáveis.

Antes de alterar totalizadores, confirme exatamente quais registros participam do cálculo.

## 8. Integrações financeiras

Ao tratar dados externos:

- preserve o dado original;
- mantenha rastreabilidade entre dado bruto e dado tratado;
- use identificadores estáveis quando disponíveis;
- trate sincronização parcial e registros incompletos;
- evite reprocessamentos que gerem duplicidade;
- não substitua silenciosamente descrições originais;
- não crie reconhecimento textual paralelo quando já existir estrutura configurável.

## 9. Interface

O Atlas deve permanecer:

- premium;
- pessoal;
- minimalista;
- claro;
- responsivo;
- consistente;
- com boa densidade de informação.

Evite aparência de ERP, painel administrativo genérico ou internet banking antigo.

Antes de criar algo novo, procure componentes e padrões já existentes.

- Não adicione ícones meramente decorativos.
- Não crie cards quando uma lista ou faixa simples resolver melhor.
- Não use cores excessivas.
- Use cor como reforço, não como única informação.
- Preserve hierarquia, acessibilidade, tema e formatação brasileira.
- Valores numéricos devem ter alinhamento consistente.
- Estados de foco, carregamento, vazio e erro devem ser tratados.

No mobile, não dependa de uma tabela larga com rolagem horizontal como solução principal.

## 10. Consultas e performance

Evite:

- consultas N+1;
- consultas sequenciais por item;
- agregações duplicadas;
- carregamento antecipado de detalhes;
- prefetch de consultas financeiras;
- envio de dados desnecessários ao cliente.

Prefira:

- consultas em lote;
- agregação no servidor;
- carregamento sob demanda;
- seleção apenas dos campos necessários;
- reutilização segura de cálculos e resultados.

Não adicione complexidade de performance sem necessidade comprovada.

## 11. Erros e estados

Não transforme erros em listas vazias ou valores que aparentem sucesso.

Diferencie quando aplicável:

- carregamento;
- ausência legítima de dados;
- erro de consulta;
- erro de autorização;
- erro de integração;
- sincronização parcial;
- registro incompleto;
- falha ao salvar.

Não use `catch` vazio.

Remova logs e código temporário antes de concluir.

## 12. Verificação

Depois de implementar:

1. revise o diff completo;
2. confirme que apenas arquivos necessários foram alterados;
3. remova imports, logs e código temporário;
4. execute os scripts aplicáveis definidos em `package.json`;
5. execute TypeScript e lint;
6. execute testes relacionados;
7. execute build quando a mudança puder afetar produção;
8. confira estados normal, vazio, carregando e erro;
9. confira desktop e mobile em mudanças visuais;
10. confirme autenticação, workspace, RLS e ausência de duplicidade.

Não invente nomes de scripts.

Não afirme que um comando passou se ele não foi executado.

## 13. Entrega final

Ao concluir, informe objetivamente:

- o que foi implementado;
- arquivos alterados;
- decisões técnicas relevantes;
- migrations ou índices criados;
- regras de negócio aplicadas;
- comandos realmente executados;
- resultados das verificações;
- limitações ou pendências reais.

Não responda apenas com uma proposta quando a tarefa solicitar implementação.

Não deixe placeholders, comentários de continuação ou código incompleto.
