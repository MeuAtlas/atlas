"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
  type FormEvent,
} from "react";
import {
  createSimpleCommitment,
  parseCommitmentText,
} from "@/modules/finance/commitments-actions";
import {
  formatBrazilianMoney,
  parseBrazilianMoneyToCents,
  type ParsedCommitmentText,
  type SimpleCommitmentRecurrence,
} from "@/modules/finance/simple-commitments";
import type { CommitmentsOverview } from "@/modules/finance/commitments-query";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import { FormField } from "./form-parts";

type Option = { id: string; name: string };
type PersonOption = CommitmentsOverview["people"][number];
type FormErrors = Record<string, string>;

const recurrenceOptions: Array<[SimpleCommitmentRecurrence, string]> = [
  ["none", "Não"],
  ["monthly", "Todo mês"],
  ["weekly", "Toda semana"],
  ["biweekly", "A cada 15 dias"],
  ["annual", "Todo ano"],
  ["custom", "Outra frequência"],
];

const templates = [
  ["Escola", "monthly", "personal"],
  ["Pensão", "monthly", "personal"],
  ["Plano de saúde", "monthly", "personal"],
  ["Academia", "monthly", "personal"],
  ["Internet", "monthly", "household"],
  ["Assinatura", "monthly", "personal"],
  ["Aluguel", "monthly", "household"],
  ["Condomínio", "monthly", "household"],
] as const;

const today = () => new Date().toISOString().slice(0, 10);

function dateWithDay(day: number) {
  const now = new Date();
  const lastDay = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 0),
  ).getUTCDate();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-${
    String(Math.min(day, lastDay)).padStart(2, "0")
  }`;
}

function recurrenceLabel(value: string) {
  return recurrenceOptions.find(([key]) => key === value)?.[1] ??
    "Não informado";
}

export function CommitmentValidationSummary({
  errors,
  message,
}: {
  errors: FormErrors;
  message?: string;
}) {
  const unique = [...new Set(Object.values(errors))];
  if (!unique.length && !message) return null;
  return (
    <section
      className="simple-commitment-errors"
      role="alert"
      tabIndex={-1}
      data-simple-errors
    >
      <strong>Revise os dados antes de adicionar</strong>
      {message ? <p>{message}</p> : null}
      {unique.length ? (
        <ul>{unique.map(error => <li key={error}>{error}</li>)}</ul>
      ) : null}
    </section>
  );
}

export function CommitmentNaturalLanguageInput({
  value,
  busy,
  message,
  onChange,
  onInterpret,
  onManual,
}: {
  value: string;
  busy: boolean;
  message: string;
  onChange: (value: string) => void;
  onInterpret: () => void;
  onManual: () => void;
}) {
  return (
    <section className="commitment-natural-input">
      <label htmlFor="commitment-description">
        <span>Descreva o compromisso</span>
        <textarea
          id="commitment-description"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="Ex.: Escola da Anna, R$ 1.210 por mês, vence dia 5."
          rows={3}
          data-autofocus
        />
      </label>
      {message ? <p role="status">{message}</p> : null}
      <div>
        <button
          type="button"
          className="finance-button"
          disabled={busy || value.trim().length < 3}
          onClick={onInterpret}
        >
          {busy ? "Interpretando…" : "Preencher automaticamente"}
        </button>
        <button type="button" className="simple-text-link" onClick={onManual}>
          Prefiro preencher manualmente
        </button>
      </div>
    </section>
  );
}

export function CommitmentSummaryPreview({
  title,
  amount,
  recurrence,
  scheduleDate,
  relationName,
}: {
  title: string;
  amount: string;
  recurrence: string;
  scheduleDate: string;
  relationName: string;
}) {
  const cents = parseBrazilianMoneyToCents(amount);
  return (
    <section className="simple-commitment-preview" aria-label="Resumo editável">
      <span>Confira o compromisso</span>
      <strong>{title || "Nome não informado"}</strong>
      <p>
        {cents === null ? "Valor não informado" : formatBrazilianMoney(cents)}
        {recurrence && recurrence !== "none"
          ? ` · ${recurrenceLabel(recurrence).toLocaleLowerCase("pt-BR")}`
          : ""}
      </p>
      <small>
        {scheduleDate
          ? `Quando: ${new Intl.DateTimeFormat("pt-BR", {
              timeZone: "UTC",
            }).format(new Date(`${scheduleDate}T12:00:00Z`))}`
          : "Data não informada"}
        {" · "}
        Relacionado a: {relationName}
      </small>
    </section>
  );
}

export function CommitmentAdvancedFields({
  categories,
  accounts,
  cards,
}: {
  categories: Option[];
  accounts: Option[];
  cards: Option[];
}) {
  const [variable, setVariable] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState("");
  return (
    <details className="simple-commitment-advanced">
      <summary>Mais detalhes</summary>
      <div className="simple-commitment-grid">
        <FormField name="category_id" label="Categoria">
          <select id="category_id" name="category_id">
            <option value="">Sem categoria</option>
            {categories.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FormField>
        <FormField name="payment_method" label="Forma de pagamento">
          <select
            id="payment_method"
            name="payment_method"
            value={paymentMethod}
            onChange={event => setPaymentMethod(event.target.value)}
          >
            <option value="">Definir depois</option>
            <option value="transfer">Conta bancária</option>
            <option value="credit_card">Cartão</option>
            <option value="bank_debit">Débito automático</option>
            <option value="boleto">Boleto</option>
            <option value="pix">Pix</option>
            <option value="payroll">Desconto em folha</option>
            <option value="cash">Manual</option>
            <option value="other">Outro</option>
          </select>
        </FormField>
        {paymentMethod === "payroll" ? (
          <p className="payroll-form-help wide">
            Esse valor já é retirado antes do salário líquido entrar na conta.
            Ele aparecerá nas análises, mas não será descontado novamente do
            saldo disponível.
          </p>
        ) : null}
        {paymentMethod !== "payroll" ? <FormField name="account_id" label="Conta">
          <select id="account_id" name="account_id">
            <option value="">Nenhuma</option>
            {accounts.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FormField> : null}
        {paymentMethod !== "payroll" ? <FormField name="card_id" label="Cartão">
          <select id="card_id" name="card_id">
            <option value="">Nenhum</option>
            {cards.map(item => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </FormField> : null}
        <label className="simple-choice wide">
          <span>O valor costuma mudar?</span>
          <select
            name="variable_amount_choice"
            value={variable ? "yes" : "no"}
            onChange={event => setVariable(event.target.value === "yes")}
          >
            <option value="no">Não</option>
            <option value="yes">Sim</option>
          </select>
          <input
            type="hidden"
            name="variable_amount"
            value={variable ? "true" : "false"}
          />
        </label>
        {variable ? (
          <>
            <FormField name="minimum_expected_amount" label="Valor mínimo">
              <input
                id="minimum_expected_amount"
                name="minimum_expected_amount"
                inputMode="decimal"
                placeholder="R$ 0,00"
              />
            </FormField>
            <FormField name="maximum_expected_amount" label="Valor máximo">
              <input
                id="maximum_expected_amount"
                name="maximum_expected_amount"
                inputMode="decimal"
                placeholder="R$ 0,00"
              />
            </FormField>
          </>
        ) : null}
        <FormField name="end_date" label="Data final">
          <input id="end_date" name="end_date" type="date" />
        </FormField>
        <FormField name="budget_priority" label="Este gasto é">
          <select id="budget_priority" name="budget_priority" defaultValue="unknown">
            <option value="unknown">Definir depois</option>
            <option value="essential">Essencial</option>
            <option value="adjustable">Ajustável</option>
            <option value="optional">Opcional</option>
          </select>
        </FormField>
        <FormField name="notes" label="Observação" wide>
          <textarea id="notes" name="notes" rows={2} />
        </FormField>
      </div>
    </details>
  );
}

export function CommitmentQuickForm({
  values,
  errors,
  people,
  categories,
  accounts,
  cards,
  onChange,
}: {
  values: {
    title: string;
    amount: string;
    scheduleDate: string;
    recurrence: string;
    relationTarget: string;
  };
  errors: FormErrors;
  people: PersonOption[];
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  onChange: (field: string, value: string) => void;
}) {
  return (
    <>
      <div className="commitment-template-list" aria-label="Modelos rápidos">
        {templates.map(([name, recurrence, relation]) => (
          <button
            type="button"
            key={name}
            onClick={() => {
              onChange("title", name);
              onChange("recurrence", recurrence);
              onChange("relationTarget", relation);
            }}
          >
            {name}
          </button>
        ))}
      </div>
      <div className="simple-commitment-grid">
        <FormField
          name="title"
          label="1. O que é?"
          required
          error={errors.title}
          wide
        >
          <input
            id="title"
            name="title"
            value={values.title}
            onChange={event => onChange("title", event.target.value)}
            placeholder="Ex.: Escola da Anna"
            aria-invalid={Boolean(errors.title)}
          />
        </FormField>
        <FormField
          name="amount"
          label="2. Quanto custa?"
          required
          error={errors.amount}
        >
          <input
            id="amount"
            name="amount"
            value={values.amount}
            onChange={event => onChange("amount", event.target.value)}
            onBlur={() => {
              const cents = parseBrazilianMoneyToCents(values.amount);
              if (cents !== null) onChange("amount", formatBrazilianMoney(cents));
            }}
            inputMode="decimal"
            placeholder="R$ 1.210,00"
            aria-invalid={Boolean(errors.amount)}
          />
        </FormField>
        <FormField
          name="schedule_date"
          label={values.recurrence === "monthly"
            ? "3. Primeiro vencimento"
            : "3. Quando acontece?"}
          required
          error={errors.scheduleDate}
        >
          <input
            id="schedule_date"
            name="schedule_date"
            type="date"
            value={values.scheduleDate}
            onChange={event => onChange("scheduleDate", event.target.value)}
            aria-invalid={Boolean(errors.scheduleDate)}
          />
        </FormField>
        <FormField
          name="recurrence"
          label="4. Repete?"
          required
          error={errors.recurrence}
        >
          <select
            id="recurrence"
            name="recurrence"
            value={values.recurrence}
            onChange={event => onChange("recurrence", event.target.value)}
            aria-invalid={Boolean(errors.recurrence)}
          >
            <option value="">Escolha uma opção</option>
            {recurrenceOptions.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </FormField>
        <FormField
          name="relation_target"
          label="5. É relacionado a quem ou a quê?"
          error={errors.relationTarget}
        >
          <select
            id="relation_target"
            name="relation_target"
            value={values.relationTarget}
            onChange={event => onChange("relationTarget", event.target.value)}
          >
            <option value="personal">Pessoal</option>
            <option value="household">Casa</option>
            <option value="work">Trabalho</option>
            <option value="travel">Viagem</option>
            {people.map(item => (
              <option key={item.person.id} value={`person:${item.person.id}`}>
                {item.person.name}
              </option>
            ))}
          </select>
        </FormField>
      </div>
      <CommitmentAdvancedFields
        categories={categories}
        accounts={accounts}
        cards={cards}
      />
    </>
  );
}

export function CommitmentSuccessState({
  onAddAnother,
  onView,
  onClose,
}: {
  onAddAnother: () => void;
  onView: () => void;
  onClose: () => void;
}) {
  return (
    <div className="simple-commitment-success">
      <span aria-hidden="true">✓</span>
      <h2>Compromisso adicionado.</h2>
      <p>A ocorrência e a próxima previsão já foram organizadas pelo Atlas.</p>
      <div>
        <button type="button" className="finance-button" onClick={onAddAnother}>
          Adicionar outro
        </button>
        <button type="button" className="finance-button secondary" onClick={onView}>
          Ver compromisso
        </button>
        <button type="button" className="simple-text-link" onClick={onClose}>
          Fechar
        </button>
      </div>
    </div>
  );
}

export function SimpleCommitmentModal({
  workspaceId,
  people,
  categories,
  accounts,
  cards,
  initialPersonId,
  onClose,
  onMessage,
}: {
  workspaceId: string;
  people: PersonOption[];
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  initialPersonId?: string;
  onClose: () => void;
  onMessage: (message: string) => void;
}) {
  const router = useRouter();
  const formRef = useRef<HTMLFormElement>(null);
  const [pending, startTransition] = useTransition();
  const [mode, setMode] = useState<"text" | "form">(
    initialPersonId ? "form" : "text",
  );
  const [sourceText, setSourceText] = useState("");
  const [parserMessage, setParserMessage] = useState("");
  const [errors, setErrors] = useState<FormErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [values, setValues] = useState({
    title: "",
    amount: "",
    scheduleDate: today(),
    recurrence: "",
    relationTarget: initialPersonId ? `person:${initialPersonId}` : "personal",
  });
  const relationName = useMemo(() => {
    if (values.relationTarget === "household") return "Casa";
    if (values.relationTarget === "work") return "Trabalho";
    if (values.relationTarget === "travel") return "Viagem";
    if (values.relationTarget.startsWith("person:")) {
      return people.find(item =>
        item.person.id === values.relationTarget.slice(7)
      )?.person.name ?? "Pessoa";
    }
    return "Pessoal";
  }, [people, values.relationTarget]);

  useEffect(() => {
    if (!Object.keys(errors).length) return;
    window.requestAnimationFrame(() => {
      formRef.current?.querySelector<HTMLElement>("[data-simple-errors]")
        ?.focus();
      const first = formRef.current?.querySelector<HTMLElement>(
        "[aria-invalid='true']",
      );
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }, [errors]);

  const updateValue = (field: string, value: string) => {
    setValues(current => ({ ...current, [field]: value }));
    setErrors(current => {
      const next = { ...current };
      delete next[field];
      return next;
    });
  };

  const applyParsed = (parsed: ParsedCommitmentText) => {
    const person = parsed.personName
      ? people.find(item =>
          item.person.name.localeCompare(
            parsed.personName!,
            "pt-BR",
            { sensitivity: "base" },
          ) === 0
        )
      : null;
    setValues(current => ({
      ...current,
      title: parsed.title ?? current.title,
      amount: parsed.amountCents === null
        ? current.amount
        : formatBrazilianMoney(parsed.amountCents),
      recurrence: parsed.recurrence ?? current.recurrence,
      scheduleDate: parsed.dueDate ??
        (parsed.dueDay ? dateWithDay(parsed.dueDay) : current.scheduleDate),
      relationTarget: person
        ? `person:${person.person.id}`
        : parsed.context ?? current.relationTarget,
    }));
    setErrors(Object.fromEntries(parsed.missingFields.map(field => [
      field === "schedule" ? "scheduleDate" : field,
      field === "title" ? "Informe o nome do compromisso."
        : field === "amount" ? "Informe um valor válido."
          : field === "schedule" ? "Informe quando o compromisso acontece."
            : "Escolha se o compromisso se repete.",
    ])));
    setMode("form");
  };

  const interpret = () => {
    startTransition(async () => {
      const data = new FormData();
      data.set("workspace_id", workspaceId);
      data.set("text", sourceText);
      const result = await parseCommitmentText(data);
      setParserMessage(result.message);
      if (result.parsed) applyParsed(result.parsed);
    });
  };

  const validate = () => {
    const next: FormErrors = {};
    if (!values.title.trim()) next.title = "Informe o nome do compromisso.";
    if (parseBrazilianMoneyToCents(values.amount) === null) {
      next.amount = "Informe um valor válido.";
    }
    if (!values.scheduleDate) {
      next.scheduleDate = "Informe quando o compromisso acontece.";
    }
    if (!values.recurrence) {
      next.recurrence = "Escolha se o compromisso se repete.";
    }
    setErrors(next);
    setFormMessage(Object.keys(next).length
      ? "Preencha os campos obrigatórios destacados."
      : "");
    return Object.keys(next).length === 0;
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!validate()) return;
    const data = new FormData(event.currentTarget);
    data.set("workspace_id", workspaceId);
    data.set("natural_language_source", sourceText);
    startTransition(async () => {
      const result = await createSimpleCommitment(data);
      if (!result.ok) {
        setErrors(Object.fromEntries(
          Object.entries(result.fieldErrors).map(([field, messages]) => [
            field,
            messages[0] ?? "Revise este campo.",
          ]),
        ));
        setFormMessage(result.message);
        return;
      }
      setCreatedId(result.id ?? "");
      onMessage(result.message);
      router.refresh();
    });
  };

  const reset = () => {
    setCreatedId(null);
    setMode("text");
    setSourceText("");
    setParserMessage("");
    setErrors({});
    setFormMessage("");
    setValues({
      title: "",
      amount: "",
      scheduleDate: today(),
      recurrence: "",
      relationTarget: "personal",
    });
  };

  if (createdId !== null) {
    return (
      <CommitmentSuccessState
        onAddAnother={reset}
        onView={onClose}
        onClose={onClose}
      />
    );
  }

  return (
    <form ref={formRef} className="simple-commitment-form" onSubmit={submit}>
      <AtlasModalHeader>
        <div>
          <p className="eyebrow">Organização financeira</p>
          <h2>Adicionar compromisso</h2>
          <p>Informe o básico. Os demais detalhes podem ser ajustados depois.</p>
        </div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody>
        <CommitmentValidationSummary errors={errors} message={formMessage} />
        {mode === "text" ? (
          <CommitmentNaturalLanguageInput
            value={sourceText}
            busy={pending}
            message={parserMessage}
            onChange={setSourceText}
            onInterpret={interpret}
            onManual={() => setMode("form")}
          />
        ) : (
          <>
            {sourceText ? (
              <CommitmentSummaryPreview
                title={values.title}
                amount={values.amount}
                recurrence={values.recurrence}
                scheduleDate={values.scheduleDate}
                relationName={relationName}
              />
            ) : null}
            <CommitmentQuickForm
              values={values}
              errors={errors}
              people={people}
              categories={categories}
              accounts={accounts}
              cards={cards}
              onChange={updateValue}
            />
          </>
        )}
      </AtlasModalBody>
      {mode === "form" ? (
        <AtlasModalFooter>
          <span>Campos marcados com * são obrigatórios.</span>
          <button type="button" className="finance-button secondary" onClick={onClose}>
            Cancelar
          </button>
          <button type="submit" className="finance-button" disabled={pending}>
            {pending
              ? "Adicionando…"
              : sourceText
                ? "Confirmar e adicionar"
                : "Adicionar"}
          </button>
        </AtlasModalFooter>
      ) : null}
    </form>
  );
}
