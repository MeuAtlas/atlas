"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  AtlasModal,
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import { SimpleCommitmentModal } from "@/components/finance/commitments/simple-commitment-modal";
import { useClientNavigation } from "@/components/navigation/client-navigation";
import { IncomeExpenseDashboardView } from "./income-expense-dashboard";
import type { CommitmentsOverview } from "@/modules/finance/commitments-query";
import type {
  IncomeExpenseListItem,
  IncomeExpensePageData,
} from "@/modules/finance/income-expenses-query";
import {
  createHistoricalIncome,
  createSimpleIncome,
  previewHistoricalIncome,
  recognizeExpensePaymentSource,
  setNextIncomeExpectedAmount,
  updateExpenseDefinition,
  type IncomeHistoryPreviewActionResult,
} from "@/modules/finance/income-expenses-actions";

type Option = { id: string; name: string };
type ReferenceTransaction = {
  id: string;
  description: string;
  amountCents: number;
  date: string;
  accountName: string;
};
type ModalState =
  | "choose"
  | "income"
  | "expense"
  | "payroll"
  | { kind: "details"; item: IncomeExpenseListItem }
  | null;

const money = (cents: number | null) =>
  cents === null
    ? "Sem estimativa"
    : new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: "BRL",
      }).format(cents / 100);

const monthLabel = (month: string) =>
  new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${month.slice(0, 7)}-01T12:00:00Z`));

const contextLabels = {
  personal: "Pessoal",
  household: "Casa",
  work: "Trabalho",
  travel: "Viagem",
};

const incomeStatusLabels: Record<string, string> = {
  expected: "A receber",
  projected: "A receber",
  pending: "A receber",
  partially_received: "Parcialmente recebida",
  received: "Recebida",
  paid: "Recebida",
  above_expected: "Acima do esperado",
  below_expected: "Abaixo do esperado",
  overdue: "Atrasada",
};

const expenseStatusLabels: Record<string, string> = {
  expected: "A pagar",
  projected: "Prevista",
  pending: "A pagar",
  partially_paid: "Parcialmente paga",
  paid: "Paga",
  overdue: "Atrasada",
};

const paymentMethodLabels: Record<string, string> = {
  bank_debit: "Conta bancária",
  bank_account: "Conta bancária",
  credit_card: "Cartão de crédito",
  payroll: "Desconto em folha",
  payroll_deduction: "Desconto em folha",
  pix: "Pix",
  boleto: "Boleto",
  cash: "Dinheiro",
  transfer: "Transferência",
  manual: "Manual",
  other: "Outro",
};
const editablePaymentMethods = [
  "bank_debit",
  "credit_card",
  "payroll",
  "pix",
  "boleto",
  "cash",
  "transfer",
  "other",
] as const;

const recurrenceLabels: Record<string, string> = {
  none: "Não recorrente",
  monthly: "Mensal",
  weekly: "Semanal",
  biweekly: "Quinzenal",
  yearly: "Anual",
  custom: "Personalizada",
};

const dateLabel = (date: string) =>
  new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" })
    .format(new Date(`${date.slice(0, 10)}T12:00:00Z`));

const paymentMethodLabel = (item: IncomeExpenseListItem) => {
  if (item.isPayrollDeduction) return "Desconto em folha";
  if (item.paymentMethod && paymentMethodLabels[item.paymentMethod]) {
    return paymentMethodLabels[item.paymentMethod];
  }
  return {
    bank: "Conta bancária",
    card: "Cartão de crédito",
    payroll: "Desconto em folha",
    manual: "Manual",
    other: "Não informada",
  }[item.paymentChannel];
};

function FlowList({
  title,
  eyebrow,
  items,
  empty,
  onOpen,
}: {
  title: string;
  eyebrow: string;
  items: IncomeExpenseListItem[];
  empty: string;
  onOpen: (item: IncomeExpenseListItem) => void;
}) {
  return (
    <section className="finance-panel income-expense-panel">
      <header>
        <div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>
      </header>
      {items.length ? (
        <div className="income-expense-list">
          {items.map(item => (
            <button type="button" key={item.id} onClick={() => onOpen(item)} className={`flow-row flow-${item.direction}`}>
              <span className="flow-main">
                <b>{item.title}</b>
                <small>
                  {item.personNames[0]
                    ? `${item.personNames[0]} · `
                    : ""}{item.isPayrollDeduction
                    ? "já considerado na renda líquida"
                    : item.estimationMethod === "historical_median"
                    ? `variável · mediana de ${item.historicalMonthsCount} mês(es)`
                    : item.categoryName ?? contextLabels[item.contextType]}
                </small>
              </span>
              <span><small>Esperado</small><b>{money(item.expectedAmountCents)}</b></span>
              <span>
                <small>{item.direction === "income" ? "Recebido" : "Pago"}</small>
                <b>{money(item.realizedAmountCents)}</b>
              </span>
              <span className={`flow-status status-${item.occurrenceStatus}`}>
                {(item.direction === "income"
                  ? incomeStatusLabels
                  : expenseStatusLabels)[item.occurrenceStatus] ??
                  item.occurrenceStatus}
              </span>
            </button>
          ))}
        </div>
      ) : (
        <div className="commitment-empty compact">
          <h3>{empty}</h3>
        </div>
      )}
    </section>
  );
}

function PayrollDeductionsModalContent({ data }: { data: IncomeExpensePageData }) {
  const total = data.payrollDeductions.reduce(
    (sum, item) => sum + (item.realizedAmountCents || item.expectedAmountCents), 0,
  );
  return <>
    <AtlasModalHeader>
      <div><p className="eyebrow">Composição informativa</p><h2>Descontos em folha</h2>
        <p>{monthLabel(data.month)} · {data.payrollDeductions.length} item(ns)</p></div>
      <AtlasModalClose />
    </AtlasModalHeader>
    <AtlasModalBody>
      <div className="ied-payroll-modal-summary"><span>Total da competência</span><strong>{money(total)}</strong></div>
      <p className="ied-payroll-modal-note">Estes valores já foram descontados antes do salário líquido ser creditado e não reduzem novamente o saldo disponível.</p>
      <div className="ied-payroll-modal-list">
        {data.payrollDeductions.map(item => <article key={item.id}>
          <span><b>{item.title}</b><small>{[item.categoryName, ...item.personNames].filter(Boolean).join(" · ") || "Sem classificação adicional"}</small></span>
          <span><strong>{money(item.realizedAmountCents || item.expectedAmountCents)}</strong><small>{item.realizedAmountCents ? "Confirmado" : "Estimado"}</small></span>
        </article>)}
      </div>
    </AtlasModalBody>
  </>;
}

function ChooseFlowModal({ onChoose }: {
  onChoose: (value: "income" | "expense") => void;
}) {
  return (
    <>
      <AtlasModalHeader>
        <div><p className="eyebrow">Adicionar</p><h2>O que deseja cadastrar?</h2>
          <p>Receitas e despesas usam o mesmo acompanhamento mensal.</p></div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody>
        <div className="flow-choice-grid">
          <button type="button" onClick={() => onChoose("income")}>
            <span>＋</span><b>Receita</b>
            <small>Um valor que você espera receber.</small>
          </button>
          <button type="button" onClick={() => onChoose("expense")}>
            <span>−</span><b>Despesa</b>
            <small>Um valor que você espera pagar.</small>
          </button>
        </div>
      </AtlasModalBody>
    </>
  );
}

function IncomeForm({
  workspaceId,
  people,
  references,
  onSaved,
}: {
  workspaceId: string;
  people: CommitmentsOverview["people"];
  references: ReferenceTransaction[];
  onSaved: (message: string) => void;
}) {
  const [mode, setMode] = useState<"fixed" | "historical">("fixed");
  const [preview, setPreview] = useState<
    Extract<IncomeHistoryPreviewActionResult, { ok: true }>["preview"] | null
  >(null);
  const [feedback, setFeedback] = useState("");
  const [pending, startTransition] = useTransition();
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("workspace_id", workspaceId);
    startTransition(async () => {
      const result = mode === "fixed"
        ? await createSimpleIncome(data)
        : await createHistoricalIncome(data);
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      onSaved(result.message);
    });
  };
  const previewReference = (referenceId: string) => {
    setPreview(null);
    setFeedback("");
    if (!referenceId) return;
    const data = new FormData();
    data.set("workspace_id", workspaceId);
    data.set("reference_transaction_id", referenceId);
    startTransition(async () => {
      const result = await previewHistoricalIncome(data);
      if (!result.ok) {
        setFeedback(result.message);
        return;
      }
      setPreview(result.preview);
    });
  };
  return (
    <form className="income-create-form" onSubmit={submit}>
      <AtlasModalHeader>
        <div><p className="eyebrow">Nova receita</p><h2>Adicionar receita</h2>
          <p>Informe o básico. O Atlas organiza previsão e recebimentos.</p></div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody>
        {feedback ? <p className="flow-form-error" role="alert">{feedback}</p> : null}
        <label className="wide"><span>1. O que é? *</span>
          <input name="title" required placeholder="Ex.: Receitas GOL" data-autofocus />
        </label>
        <fieldset className="income-estimation-choice">
          <legend>2. Como definir o valor esperado?</legend>
          <label><input type="radio" checked={mode === "fixed"} onChange={() => {
            setMode("fixed"); setPreview(null); setFeedback("");
          }} /> <span><b>Informar valor</b><small>Para receitas com valor conhecido.</small></span></label>
          <label><input type="radio" checked={mode === "historical"} onChange={() => {
            setMode("historical"); setPreview(null); setFeedback("");
          }} /> <span><b>Calcular pelo histórico bancário</b><small>Usa a mediana dos totais mensais.</small></span></label>
        </fieldset>
        {mode === "fixed" ? (
          <label><span>Valor esperado *</span>
            <input name="amount" required inputMode="decimal" placeholder="R$ 2.000,00" />
          </label>
        ) : (
          <label className="wide"><span>Escolher uma entrada da conta *</span>
            <select
              name="reference_transaction_id"
              required
              defaultValue=""
              onChange={event => previewReference(event.target.value)}
            >
              <option value="" disabled>Selecione uma entrada</option>
              {references.map(item => (
                <option value={item.id} key={item.id}>
                  {new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(
                    new Date(`${item.date}T12:00:00Z`),
                  )} · {item.description} · {money(item.amountCents)}
                </option>
              ))}
            </select>
          </label>
        )}
        {mode === "historical" && preview ? (
          <section className="income-history-preview">
            <header><span>Histórico encontrado</span>
              <strong>{preview.monthsCount} mês(es)</strong></header>
            <div>
              <span><small>Mediana mensal</small><b>{money(preview.medianAmountCents)}</b></span>
              <span><small>Média mensal</small><b>{money(preview.averageAmountCents)}</b></span>
              <span><small>Último mês</small><b>{money(preview.lastMonthAmountCents)}</b></span>
              <span><small>Créditos encontrados</small><b>{preview.creditsCount}</b></span>
            </div>
            <p>
              A mediana será usada como previsão padrão porque representa melhor
              um mês típico e sofre menos influência de pagamentos atípicos.
            </p>
            {preview.warning ? <em>{preview.warning}</em> : null}
          </section>
        ) : null}
        <label><span>3. Quando acontece? *</span>
          <select name="recurrence" defaultValue="monthly">
            <option value="monthly">Todo mês</option>
            <option value="none">Uma vez</option>
            <option value="custom">Outra frequência</option>
          </select>
        </label>
        <label><span>Data esperada</span>
          <select name="expected_date_rule" defaultValue="unspecified_in_month">
            <option value="unspecified_in_month">Recebimentos ao longo do mês</option>
            <option value="fixed_day">Dia fixo</option>
            <option value="first_business_day">Primeiro dia útil</option>
            <option value="fifth_business_day">Quinto dia útil</option>
            <option value="last_business_day">Último dia útil</option>
          </select>
        </label>
        <label><span>Dia fixo, se aplicável</span>
          <input name="expected_date_day" type="number" min="1" max="31" />
        </label>
        <label><span>4. Contexto</span>
          <select
            key={mode}
            name="relation_target"
            defaultValue={mode === "historical" ? "work" : "personal"}
          >
            <option value="personal">Pessoal</option>
            <option value="work">Trabalho</option>
            <option value="household">Casa</option>
            <option value="travel">Viagem</option>
            {people.map(item => (
              <option key={item.person.id} value={`person:${item.person.id}`}>
                {item.person.name}
              </option>
            ))}
          </select>
        </label>
        <details className="wide simple-commitment-advanced">
          <summary>Mais detalhes</summary>
          <label><span>Observação</span><textarea name="notes" rows={2} /></label>
          {mode === "historical" && preview?.medianAmountCents === null ? (
            <label><span>Valor esperado provisório</span>
              <input name="manual_expected_amount" placeholder="R$ 0,00" />
            </label>
          ) : null}
        </details>
      </AtlasModalBody>
      <AtlasModalFooter>
        <span>{mode === "historical"
          ? preview
            ? `Usar mediana de ${money(preview.medianAmountCents)}`
            : "Escolha uma entrada para analisar o histórico."
          : "O realizado substituirá a previsão no fechamento."}</span>
        <button
          className="finance-button"
          disabled={pending || (mode === "historical" && !preview)}
        >
          {pending ? "Adicionando…" : "Adicionar"}
        </button>
      </AtlasModalFooter>
    </form>
  );
}

function FlowDetails({
  item,
  workspaceId,
  month,
  people,
  categories,
  accounts,
  cards,
  onSaved,
}: {
  item: IncomeExpenseListItem;
  workspaceId: string;
  month: string;
  people: CommitmentsOverview["people"];
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  onSaved: (message: string) => void;
}) {
  const [pending, startTransition] = useTransition();
  const [feedback, setFeedback] = useState("");
  const [editing, setEditing] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState(
    item.paymentMethod === "bank_account"
      ? "bank_debit"
      : item.paymentMethod === "manual"
        ? "other"
        : editablePaymentMethods.includes(
          item.paymentMethod as (typeof editablePaymentMethods)[number],
        )
          ? item.paymentMethod!
          : "other",
  );
  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("workspace_id", workspaceId);
    data.set("commitment_id", item.id);
    data.set("month", month.slice(0, 7));
    startTransition(async () => {
      const result = await setNextIncomeExpectedAmount(data);
      if (!result.ok) setFeedback(result.message);
      else onSaved(result.message);
    });
  };
  const submitExpense = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    data.set("workspace_id", workspaceId);
    data.set("commitment_id", item.id);
    data.set("month", month.slice(0, 7));
    startTransition(async () => {
      const result = await updateExpenseDefinition(data);
      if (!result.ok) setFeedback(result.message);
      else onSaved(result.message);
    });
  };
  const recognizePaymentSource = () => {
    if (!item.occurrenceId || !item.linkedTransactionId) return;
    const data = new FormData();
    data.set("workspace_id", workspaceId);
    data.set("commitment_id", item.id);
    data.set("occurrence_id", item.occurrenceId);
    data.set("transaction_id", item.linkedTransactionId);
    data.set("month", month.slice(0, 7));
    startTransition(async () => {
      const result = await recognizeExpensePaymentSource(data);
      if (!result.ok) setFeedback(result.message);
      else onSaved(result.message);
    });
  };
  return (
    <>
      <AtlasModalHeader>
        <div><p className="eyebrow">{item.direction === "income" ? "Receita" : "Despesa"}</p>
          <h2>{item.title}</h2>
          <p>{contextLabels[item.contextType]} · {monthLabel(item.competenceMonth)}</p></div>
        <div className="flow-detail-header-actions">
          {item.direction === "expense" ? (
            <button
              className="finance-button secondary"
              type="button"
              onClick={() => {
                setFeedback("");
                setEditing(value => !value);
              }}
            >
              {editing ? "Cancelar edição" : "Editar"}
            </button>
          ) : null}
          <AtlasModalClose />
        </div>
      </AtlasModalHeader>
      <AtlasModalBody>
        <section className="flow-detail-summary">
          <div><span>Esperado</span><strong>{money(item.expectedAmountCents)}</strong></div>
          <div><span>{item.direction === "income" ? "Recebido" : "Pago"}</span>
            <strong>{money(item.realizedAmountCents)}</strong></div>
          <div><span>Diferença</span><strong>{money(item.differenceCents)}</strong></div>
          {item.direction === "income" && item.historicalMedianCents !== null ? (
            <><div><span>Mediana mensal</span><strong>{money(item.historicalMedianCents)}</strong></div>
              <div><span>Média mensal</span><strong>{money(item.historicalAverageCents)}</strong></div>
              <div><span>Créditos no mês</span><strong>{item.creditsCount}</strong></div></>
          ) : null}
        </section>
        {item.direction === "expense" ? (
          <section className="flow-detail-useful">
            <header>
              <div>
                <p className="eyebrow">Detalhes úteis</p>
                <h3>Como esta despesa foi registrada</h3>
              </div>
              <span className="flow-status">
                {expenseStatusLabels[item.occurrenceStatus]
                  ?? item.occurrenceStatus}
              </span>
            </header>
            <dl>
              <div>
                <dt>Forma de pagamento</dt>
                <dd>{paymentMethodLabel(item)}</dd>
              </div>
              <div>
                <dt>Pago por</dt>
                <dd>{item.paymentSourceName ?? (
                  item.isPayrollDeduction
                    ? "Folha de pagamento"
                    : "Origem não vinculada"
                )}</dd>
              </div>
              {item.expectedDate ? (
                <div>
                  <dt>Vencimento</dt>
                  <dd>{dateLabel(item.expectedDate)}</dd>
                </div>
              ) : null}
              {item.paymentDate ? (
                <div>
                  <dt>Pagamento</dt>
                  <dd>{dateLabel(item.paymentDate)}</dd>
                </div>
              ) : null}
              {item.creditsCount > 0 ? (
                <div>
                  <dt>Pagamentos considerados</dt>
                  <dd>{item.creditsCount}</dd>
                </div>
              ) : null}
              {item.settlementSource === "card_invoice" ? (
                <div className="flow-detail-effect">
                  <dt>Quitação</dt>
                  <dd>Confirmada pelo pagamento da fatura deste cartão</dd>
                </div>
              ) : null}
              <div>
                <dt>Recorrência</dt>
                <dd>{recurrenceLabels[item.recurrenceFrequency]
                  ?? "Personalizada"}</dd>
              </div>
              {item.personNames.length ? (
                <div>
                  <dt>Pessoa</dt>
                  <dd>{item.personNames.join(", ")}</dd>
                </div>
              ) : null}
              {item.categoryName ? (
                <div>
                  <dt>Categoria</dt>
                  <dd>{item.categoryName}</dd>
                </div>
              ) : null}
              {item.isPayrollDeduction ? (
                <div className="flow-detail-effect">
                  <dt>Efeito no saldo</dt>
                  <dd>Já considerado na renda líquida</dd>
                </div>
              ) : null}
            </dl>
            {item.description ? (
              <p className="flow-detail-note">
                <span>Observação</span>
                {item.description}
              </p>
            ) : null}
            {item.paymentChannel === "bank" &&
                item.occurrenceId &&
                item.linkedTransactionId ? (
              <div className="flow-payment-source-action">
                <div>
                  <strong>Outros pagamentos do mesmo destino</strong>
                  <span>
                    Inclui outras saídas confirmadas da mesma conta e reconhece
                    as próximas competências.
                  </span>
                </div>
                <button
                  className="finance-button secondary"
                  type="button"
                  disabled={pending}
                  onClick={recognizePaymentSource}
                >
                  {pending ? "Atualizando…" : "Atualizar pagamentos"}
                </button>
              </div>
            ) : null}
            {feedback ? <p className="flow-form-error" role="alert">{feedback}</p> : null}
          </section>
        ) : null}
        {item.direction === "expense" && editing ? (
          <form className="expense-quick-edit" onSubmit={submitExpense}>
            <header>
              <div>
                <p className="eyebrow">Corrigir cadastro</p>
                <h3>Editar esta despesa</h3>
              </div>
              <p>As correções valem para este mês e para os próximos.</p>
            </header>
            {feedback ? <p className="flow-form-error" role="alert">{feedback}</p> : null}
            <label className="wide">
              <span>Nome</span>
              <input name="title" defaultValue={item.title} required maxLength={160} />
            </label>
            <label>
              <span>Valor esperado</span>
              <input name="amount" defaultValue={money(item.expectedAmountCents)} required />
            </label>
            <label>
              <span>Dia de vencimento</span>
              <input name="due_day" type="number" min={1} max={31}
                defaultValue={item.expectedDateDay ?? ""} />
            </label>
            <label>
              <span>Forma de pagamento</span>
              <select name="payment_method" value={paymentMethod}
                onChange={event => setPaymentMethod(event.target.value)}>
                {editablePaymentMethods.map(value =>
                  <option key={value} value={value}>
                    {paymentMethodLabels[value]}
                  </option>)}
              </select>
            </label>
            {paymentMethod === "credit_card" ? (
              <label>
                <span>Cartão</span>
                <select name="card_id" defaultValue={item.cardId ?? ""} required>
                  <option value="">Escolha o cartão</option>
                  {cards.map(card => <option key={card.id} value={card.id}>{card.name}</option>)}
                </select>
              </label>
            ) : paymentMethod !== "payroll" && paymentMethod !== "cash" ? (
              <label>
                <span>Conta</span>
                <select name="account_id" defaultValue={item.accountId ?? ""}>
                  <option value="">Sem conta vinculada</option>
                  {accounts.map(account =>
                    <option key={account.id} value={account.id}>{account.name}</option>)}
                </select>
              </label>
            ) : null}
            <label>
              <span>Categoria</span>
              <select name="category_id" defaultValue={item.categoryId ?? ""}>
                <option value="">Sem categoria</option>
                {categories.map(category =>
                  <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
            </label>
            <label>
              <span>Pessoa</span>
              <select name="person_id" defaultValue={item.personId ?? ""}>
                <option value="">Sem pessoa vinculada</option>
                {people.map(person =>
                  <option key={person.person.id} value={person.person.id}>
                    {person.person.name}
                  </option>)}
              </select>
            </label>
            <label className="wide">
              <span>Observação</span>
              <textarea name="description" rows={2}
                defaultValue={item.description ?? ""} />
            </label>
            <div className="expense-quick-edit-actions">
              <button className="finance-button secondary" type="button"
                onClick={() => setEditing(false)}>Cancelar</button>
              <button className="finance-button" disabled={pending}>
                {pending ? "Salvando…" : "Salvar alterações"}
              </button>
            </div>
          </form>
        ) : null}
        {item.direction === "income" ? (
          <form className="income-override-form" onSubmit={submit}>
            <h3>Informar previsão desta competência</h3>
            <p>Vale somente para {monthLabel(item.competenceMonth)} e não altera a mediana.</p>
            {feedback ? <p role="alert">{feedback}</p> : null}
            <label><span>Valor esperado específico</span>
              <input name="amount" required placeholder="R$ 0,00" /></label>
            <label><span>Observação</span><input name="notes" /></label>
            <button className="finance-button" disabled={pending}>
              {pending ? "Salvando…" : "Salvar previsão"}
            </button>
          </form>
        ) : null}
      </AtlasModalBody>
    </>
  );
}

export function IncomeExpensesWorkspace({
  data,
  activeTab,
  workspaces,
  people,
  categories,
  accounts,
  cards,
  referenceTransactions,
}: {
  data: IncomeExpensePageData;
  activeTab: "overview" | "income" | "expenses" | "people";
  workspaces: Option[];
  people: CommitmentsOverview["people"];
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  referenceTransactions: ReferenceTransaction[];
}) {
  const router = useRouter();
  const navigate = useClientNavigation();
  const [modal, setModal] = useState<ModalState>(null);
  const [toast, setToast] = useState("");
  const month = data.month.slice(0, 7);
  const query = `workspace=${data.workspaceId}&month=${month}`;
  const saved = (message: string) => {
    setModal(null);
    setToast(message);
    router.refresh();
  };
  return (
    <div className="commitments-page income-expenses-page">
      <header className="income-expense-heading">
        <div>
          <p className="eyebrow">Financeiro</p>
          <h1>Receitas e Despesas</h1>
          <p>Acompanhe o que entrou, o que saiu e o resultado do mês.</p>
        </div>
        <div className="income-expense-context">
          <label>
            <span>Espaço</span>
            <select value={data.workspaceId} onChange={event =>
              navigate(`/financeiro/receitas-despesas?workspace=${event.target.value}&month=${month}&tab=${activeTab}`)
            }>{workspaces.map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select>
          </label>
          <label>
            <span>Mês</span>
            <input type="month" value={month} onChange={event =>
              navigate(`/financeiro/receitas-despesas?workspace=${data.workspaceId}&month=${event.target.value}&tab=${activeTab}`)
            } />
          </label>
          <button className="finance-button" onClick={() => setModal("choose")}>Adicionar</button>
        </div>
      </header>
      {toast ? <p className="income-expense-toast" role="status">{toast}</p> : null}
      <nav className="income-expense-tabs" aria-label="Receitas e Despesas">
        <Link className={activeTab === "overview" ? "active" : ""} href={`/financeiro/receitas-despesas?${query}&tab=overview`}>Visão geral</Link>
        <Link className={activeTab === "income" ? "active" : ""} href={`/financeiro/receitas-despesas?${query}&tab=income`}>Receitas</Link>
        <Link className={activeTab === "expenses" ? "active" : ""} href={`/financeiro/receitas-despesas?${query}&tab=expenses`}>Despesas</Link>
        <Link className={activeTab === "people" ? "active" : ""} href={`/financeiro/receitas-despesas?${query}&tab=people`}>Pessoas e dependentes</Link>
      </nav>
      {activeTab === "overview" ? (
        <IncomeExpenseDashboardView
          dashboard={data.dashboard}
          items={[...data.incomes, ...data.expenses]}
          onOpenItem={item => setModal({ kind: "details", item })}
          onOpenPayroll={() => setModal("payroll")}
          query={query}
        />
      ) : activeTab === "income" ? (
        <FlowList title="Receitas" eyebrow="Entradas esperadas e recebidas" items={data.incomes}
          empty="Nenhuma receita cadastrada" onOpen={item => setModal({ kind: "details", item })} />
      ) : activeTab === "expenses" ? (
        <FlowList title="Despesas" eyebrow="Saídas previstas e pagas" items={data.expenses}
          empty="Nenhuma despesa cadastrada" onOpen={item => setModal({ kind: "details", item })} />
      ) : (
        <section className="finance-panel people-expense-summary">
          <header><div><p className="eyebrow">Pessoas e dependentes</p><h2>Responsabilidades financeiras</h2></div></header>
          {people.length ? <div className="finance-list">{people.map(item =>
            <div key={item.person.id}><span><b>{item.person.name}</b><small>{item.person.isDependent ? "Dependente" : "Pessoa vinculada"}</small></span></div>)}</div>
            : <div className="commitment-empty"><h3>Nenhuma pessoa cadastrada</h3></div>}
        </section>
      )}
      <AtlasModal open={modal === "choose"} onClose={() => setModal(null)}
        title="Adicionar receita ou despesa" size="small">
        <ChooseFlowModal onChoose={setModal} />
      </AtlasModal>
      <AtlasModal open={modal === "income"} onClose={() => setModal(null)}
        title="Adicionar receita" size="medium">
        <IncomeForm workspaceId={data.workspaceId} people={people}
          references={referenceTransactions} onSaved={saved} />
      </AtlasModal>
      <AtlasModal open={modal === "expense"} onClose={() => setModal(null)}
        title="Adicionar despesa" size="medium">
        <SimpleCommitmentModal workspaceId={data.workspaceId} people={people}
          categories={categories} accounts={accounts} cards={cards}
          onClose={() => setModal(null)} onMessage={saved} />
      </AtlasModal>
      <AtlasModal open={modal === "payroll"} onClose={() => setModal(null)}
        title="Composição dos descontos em folha" size="medium">
        <PayrollDeductionsModalContent data={data} />
      </AtlasModal>
      <AtlasModal open={typeof modal === "object" && modal?.kind === "details"}
        onClose={() => setModal(null)} title="Detalhes financeiros" size="large">
        {typeof modal === "object" && modal?.kind === "details"
          ? <FlowDetails item={modal.item} workspaceId={data.workspaceId}
              month={month} people={people} categories={categories}
              accounts={accounts} cards={cards} onSaved={saved} />
          : null}
      </AtlasModal>
    </div>
  );
}
