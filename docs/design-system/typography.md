# Tipografia do Atlas

O sistema tipográfico do Atlas usa papéis semânticos. Tamanho isolado (`text-xs`,
`text-[11px]` ou `style={{ fontSize: ... }}`) não deve ser usado para conteúdo.
O objetivo permanente é que nenhuma informação necessária para uma decisão
financeira exija zoom no celular.

## Escala

| Papel | Classe | Desktop | Mobile (até 800 px) |
| --- | --- | --- | --- |
| Título de página | `.atlas-page-title` | 26–32 px | 26–28 px |
| Subtítulo de página | `.atlas-page-subtitle` | 14 px | 15 px |
| Título de modal | `.atlas-modal-title` | 24–28 px | 24–26 px |
| Título de seção | `.atlas-section-title` | 18–22 px | 18–20 px |
| Título de card/item | `.atlas-card-title` / `.atlas-item-title` | 16 px | 16 px |
| Corpo | `.atlas-body` | 15 px | 16 px |
| Secundário | `.atlas-secondary` | 14 px | 15 px |
| Metadado acessório | `.atlas-caption` | 12 px | 14 px |
| Valor principal | `.atlas-financial-value` | 26–34 px | 24–30 px |
| Valor em linha | `.atlas-financial-value-small` | 18 px | 18 px |

Também existem `.atlas-body-strong`, `.atlas-label`, `.atlas-button-label`,
`.atlas-table-header`, `.atlas-table-body`, `.atlas-form-label`,
`.atlas-form-help`, `.atlas-error-text` e `.atlas-badge-text`.

O componente `AtlasText` aplica esses papéis e aceita `as`, `className` e os
atributos HTML do elemento:

```tsx
<AtlasText variant="pageTitle">Visão geral financeira</AtlasText>
<AtlasText as="p" variant="secondary">Atualizado há poucos minutos</AtlasText>
<AtlasText as="strong" variant="financialValue">R$ 12.450,00</AtlasText>
```

## Regras de uso

- Conteúdo decisório usa no mínimo 16 px no mobile; conteúdo secundário usa
  no mínimo 15 px.
- Inputs, selects e textareas usam 16 px no mobile, evitando zoom automático
  no Safari do iPhone.
- Botões e links de ação usam 16 px e alvo mínimo de 44 px no mobile.
- Badges devem conter somente status curtos. Explicações ficam em texto normal.
- Metadados abaixo de 15 px no mobile são reservados a códigos, timestamps,
  finais de cartão e marcações de gráfico.
- Valores financeiros não quebram quando houver espaço para mantê-los inteiros.
- Títulos usam `line-height` de 1.2–1.3; texto corrido usa 1.5–1.6.
- Uma regra comum é explicada uma vez no cabeçalho da seção, não em cada item.

## Contraste

Use `text-primary`, `text-secondary`, `text-tertiary` e `text-disabled` de
acordo com a função. Texto explicativo necessário nunca usa `text-disabled`.
Estados usam `text-positive`, `text-negative` e `text-warning`, acompanhados de
texto — nunca apenas cor. Os tokens têm valores próprios para claro e escuro.

## Padrões por componente

- Cards: label, valor/conteúdo principal, contexto opcional e ação opcional.
- Tabelas: cabeçalho 13 px e corpo 15 px no desktop; no mobile, linhas adaptativas
  com título 16 px, metadado 15 px e valor 18 px.
- Modais: título semântico, descrição de 16 px no mobile, padding de 20 px,
  rolagem interna e fechar com alvo de 44 × 44 px.
- Formulários: label/ajuda/erro com 15 px no mobile; controle com 16 px.
- Gráficos: eixos de 12 px no desktop e 13 px no mobile; tooltip segue corpo.
- Estados vazios: título de pelo menos 18 px, descrição de 15–16 px e ação de 16 px.

## Proteção contra regressão

`npm run typography:audit` rejeita utilitários de 7–13 px e `fontSize` inline
abaixo de 12 px em TypeScript/TSX. A allowlist atual tem três exceções explícitas
para identificadores técnicos na administração. O script também verifica os
contratos mobile de corpo, texto secundário, controles e ações. Ele roda como
parte de `npm run lint`.

O CSS legado ainda contém declarações de tamanho vinculadas ao layout original.
A camada final `Finance typography migration and accessibility guardrail`
classifica e sobrescreve esses usos por função. Não adicione novas declarações
arbitrárias a essa camada: use os tokens ou `AtlasText`.

## Auditoria de julho de 2026

A busca inicial encontrou 833 declarações de `font-size` no CSS global, incluindo
60 usos de 8 px, 124 de 9 px, 148 de 10 px e 137 de 11 px. Foram auditados os
fluxos de visão geral, movimentações, contas, cartões/faturas, empréstimos,
receitas e despesas, planejamento, relatórios, integrações, compromissos,
pessoas/dependentes, entidades, navegação, modais, formulários e gráficos.

O modal de despesas previstas foi migrado diretamente. A explicação comum fica
no cabeçalho da seção; as linhas mostram somente nome, contexto e valor.
