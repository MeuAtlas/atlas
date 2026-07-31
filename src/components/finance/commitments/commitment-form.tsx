"use client";

import {
  type FormEvent,
  type FocusEvent,
  type ChangeEvent,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  createFinancialCommitmentForm,
  updateFinancialCommitmentForm,
} from "@/modules/finance/commitments-actions";
import type {
  CommitmentListItem,
  CommitmentsOverview,
} from "@/modules/finance/commitments-query";
import {
  AtlasModalBody,
  AtlasModalClose,
  AtlasModalFooter,
  AtlasModalHeader,
} from "@/components/ui/atlas-modal";
import {
  FormErrorSummary,
  FormField,
  ToggleField,
  type FieldErrors,
} from "./form-parts";

type Option = { id: string; name: string };

const tagOptions = [
  ["required", "Obrigatório"],
  ["essential", "Essencial"],
  ["health", "Saúde"],
  ["education", "Educação"],
  ["dependent", "Dependente"],
  ["subscription", "Assinatura"],
] as const;

const frequencyLabels: Record<string, string> = {
  monthly: "Mensal",
  biweekly: "Quinzenal",
  weekly: "Semanal",
  annual: "Anual",
  custom: "Personalizada",
};

const clientMessages: Record<string, string> = {
  title: "Preencha o nome do compromisso.",
  cash_flow_direction: "Selecione o tipo do compromisso.",
  expected_amount: "Informe um valor previsto maior que zero.",
  recurrence_frequency: "Selecione a frequência.",
  recurrence_interval: "Informe o intervalo da frequência personalizada.",
  start_date: "Informe a data de início.",
  due_day: "Informe um dia de vencimento entre 1 e 31.",
  projection_confirmation: "Confirme a geração das projeções.",
  card_id: "Selecione o cartão usado no pagamento.",
};

function parseMoney(value: FormDataEntryValue | null) {
  const text = String(value ?? "").trim();
  const normalized = text.includes(",")
    ? text.replace(/\./g, "").replace(",", ".")
    : text;
  return Number(normalized);
}

function validateForm(form: HTMLFormElement) {
  const data = new FormData(form);
  const errors: FieldErrors = {};
  if (!String(data.get("title") ?? "").trim()) errors.title = clientMessages.title;
  if (!["expense", "income"].includes(String(data.get("cash_flow_direction")))) {
    errors.cash_flow_direction = clientMessages.cash_flow_direction;
  }
  if (!(parseMoney(data.get("expected_amount")) > 0)) {
    errors.expected_amount = clientMessages.expected_amount;
  }
  const frequency = String(data.get("recurrence_frequency") ?? "");
  if (!frequencyLabels[frequency]) {
    errors.recurrence_frequency = clientMessages.recurrence_frequency;
  }
  if (
    frequency === "custom" &&
    !(Number(data.get("recurrence_interval")) >= 1)
  ) {
    errors.recurrence_interval = clientMessages.recurrence_interval;
  }
  if (!String(data.get("start_date") ?? "")) {
    errors.start_date = clientMessages.start_date;
  }
  const dueDay = Number(data.get("due_day"));
  if (!Number.isInteger(dueDay) || dueDay < 1 || dueDay > 31) {
    errors.due_day = clientMessages.due_day;
  }
  if (!data.get("projection_confirmation")) {
    errors.projection_confirmation = clientMessages.projection_confirmation;
  }
  if (data.get("payment_method") === "credit_card" && !data.get("card_id")) {
    errors.card_id = clientMessages.card_id;
  }
  return errors;
}

function occurrenceEstimate(frequency: string, customInterval: number) {
  if (frequency === "weekly") return 5;
  if (frequency === "biweekly") return 3;
  if (frequency === "annual") return 1;
  if (frequency === "custom") {
    return customInterval === 1 ? 1 : 0;
  }
  return 1;
}

export function CommitmentForm({
  workspaceId,
  categories,
  accounts,
  cards,
  householdGroups,
  people,
  onClose,
  onSaved,
  item,
  initialPersonId,
}: {
  workspaceId: string;
  categories: Option[];
  accounts: Option[];
  cards: Option[];
  householdGroups: Option[];
  people: CommitmentsOverview["people"];
  onClose: () => void;
  onSaved: (message: string) => void;
  item?: CommitmentListItem;
  initialPersonId?: string;
}) {
  const commitment = item?.commitment;
  const formRef = useRef<HTMLFormElement>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);
  const [frequency, setFrequency] = useState<string>(
    commitment?.recurrenceFrequency ?? "monthly",
  );
  const [customInterval, setCustomInterval] = useState(
    commitment?.recurrenceInterval ?? 1,
  );
  const [startDate, setStartDate] = useState(
    commitment?.startDate ?? new Date().toISOString().slice(0, 10),
  );
  const [dueDay, setDueDay] = useState(String(commitment?.dueDay ?? ""));
  const [paymentMethod, setPaymentMethod] = useState(
    commitment?.paymentMethod ??
      (commitment?.commitmentType === "payroll_deduction" ? "payroll" : ""),
  );
  const [personId, setPersonId] = useState(
    initialPersonId ?? item?.people[0]?.id ?? "",
  );
  const [analysisGroupId, setAnalysisGroupId] = useState(
    commitment?.analysisGroupId ?? "",
  );
  const [sharedExpense, setSharedExpense] = useState(
    commitment?.sharedExpenseEnabled ?? false,
  );
  const [userResponsibilityType, setUserResponsibilityType] = useState(
    commitment?.userResponsibilityType ?? "fixed_amount",
  );
  const [reimbursementType, setReimbursementType] = useState(
    commitment?.reimbursementAllocationType ?? "remainder",
  );
  const [reimbursementValue, setReimbursementValue] = useState(
    commitment?.reimbursementAllocationValue == null
      ? "0"
      : String(commitment.reimbursementAllocationValue).replace(".", ","),
  );

  const estimate = useMemo(
    () => occurrenceEstimate(frequency, customInterval),
    [customInterval, frequency],
  );

  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    const name = (event.target as unknown as HTMLInputElement).name;
    if (!name || !clientMessages[name]) return;
    const next = validateForm(event.currentTarget);
    setErrors(current => ({
      ...current,
      [name]: next[name] ?? "",
    }));
  };

  const handleChange = (event: ChangeEvent<HTMLFormElement>) => {
    if (!attempted) return;
    const name = (event.target as unknown as HTMLInputElement).name;
    if (!name) return;
    const next = validateForm(event.currentTarget);
    setErrors(current => ({
      ...current,
      [name]: next[name] ?? "",
      ...(name === "payment_method" ? { card_id: next.card_id ?? "" } : {}),
    }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    setFormMessage("");
    const clientErrors = validateForm(event.currentTarget);
    setErrors(clientErrors);
    if (Object.keys(clientErrors).length) {
      const firstName = Object.keys(clientErrors)[0];
      window.requestAnimationFrame(() => {
        const first = formRef.current?.elements.namedItem(firstName);
        if (first instanceof HTMLElement) {
          first.scrollIntoView({ behavior: "smooth", block: "center" });
          first.focus();
        }
      });
      return;
    }

    setSaving(true);
    const data = new FormData(event.currentTarget);
    const result = item
      ? await updateFinancialCommitmentForm(data)
      : await createFinancialCommitmentForm(data);
    setSaving(false);
    if (!result.ok) {
      const backendErrors = Object.fromEntries(
        Object.entries(result.fieldErrors).map(([field, messages]) => [
          field,
          messages[0],
        ]),
      );
      setErrors(backendErrors);
      setFormMessage(result.message);
      window.requestAnimationFrame(() => {
        const firstName = Object.keys(backendErrors)[0];
        const first = firstName
          ? formRef.current?.elements.namedItem(firstName)
          : formRef.current?.querySelector<HTMLElement>("[data-error-summary]");
        if (first instanceof HTMLElement) {
          first.scrollIntoView({ behavior: "smooth", block: "center" });
          first.focus();
        }
      });
      return;
    }
    onSaved(result.message);
  };

  const errorProps = (name: string) => ({
    "aria-invalid": errors[name] ? true : undefined,
    "aria-describedby": errors[name] ? `${name}-error` : undefined,
  });

  return (
    <form
      ref={formRef}
      className="commitment-single-form"
      noValidate
      onSubmit={handleSubmit}
      onBlur={handleBlur}
      onChange={handleChange}
    >
      <input type="hidden" name="workspace_id" value={workspaceId} />
      <input
        type="hidden"
        name="commitment_type"
        value={paymentMethod === "payroll" ? "payroll_deduction" : "recurring"}
      />
      <input type="hidden" name="allocation_type" value="full" />
      <input type="hidden" name="allocation_value" value="100" />
      <input type="hidden" name="auto_match_enabled" value="false" />
      {item ? <input type="hidden" name="commitment_id" value={commitment?.id} /> : null}

      <AtlasModalHeader>
        <div>
          <p className="eyebrow">Planejamento recorrente</p>
          <h2>{item ? "Editar compromisso" : "Novo compromisso"}</h2>
          <p className="atlas-modal-subtitle">
            Organize a obrigação e veja imediatamente o que será projetado.
          </p>
        </div>
        <AtlasModalClose />
      </AtlasModalHeader>

      <AtlasModalBody className="commitment-single-body">
        <p className="required-legend">Campos marcados com <b>*</b> são obrigatórios.</p>
        <FormErrorSummary errors={errors} formMessage={formMessage} />

        <section className="commitment-form-section">
          <header>
            <span>1</span>
            <div><h3>Informações principais</h3><p>Defina valor, recorrência e origem.</p></div>
          </header>
          <div className="commitment-form-grid">
            <FormField name="title" label="Nome do compromisso" required error={errors.title} wide>
              <input
                id="title"
                name="title"
                maxLength={160}
                defaultValue={commitment?.title ?? ""}
                placeholder="Ex.: Plano de saúde"
                {...errorProps("title")}
              />
            </FormField>
            <FormField name="cash_flow_direction" label="Tipo" required error={errors.cash_flow_direction}>
              <select
                id="cash_flow_direction"
                name="cash_flow_direction"
                defaultValue={commitment?.cashFlowDirection ?? "expense"}
                {...errorProps("cash_flow_direction")}
              >
                <option value="expense">Despesa recorrente</option>
                <option value="income">Receita recorrente</option>
              </select>
            </FormField>
            <FormField name="expected_amount" label="Valor previsto" required error={errors.expected_amount}>
              <div className="money-input">
                <span>R$</span>
                <input
                  id="expected_amount"
                  name="expected_amount"
                  inputMode="decimal"
                  defaultValue={commitment?.expectedAmountCents == null
                    ? ""
                    : (commitment.expectedAmountCents / 100).toFixed(2).replace(".", ",")}
                  placeholder="0,00"
                  {...errorProps("expected_amount")}
                />
              </div>
            </FormField>
            <FormField
              name="amount_type"
              label="Comportamento do valor"
              help="O histórico pago nunca será reescrito."
            >
              <select
                id="amount_type"
                name="amount_type"
                defaultValue={commitment?.amountType ?? "estimated"}
              >
                <option value="estimated">Estimado — pode variar</option>
                <option value="fixed">Fixo — normalmente não muda</option>
                <option value="variable">Variável — informado a cada mês</option>
              </select>
            </FormField>
            <FormField name="recurrence_frequency" label="Frequência" required error={errors.recurrence_frequency}>
              <select
                id="recurrence_frequency"
                name="recurrence_frequency"
                value={frequency}
                onChange={event => setFrequency(event.target.value)}
                {...errorProps("recurrence_frequency")}
              >
                <option value="monthly">Mensal</option>
                <option value="biweekly">Quinzenal</option>
                <option value="weekly">Semanal</option>
                <option value="annual">Anual</option>
                <option value="custom">Personalizada</option>
              </select>
            </FormField>
            {frequency === "custom" ? (
              <FormField name="recurrence_interval" label="Repetir a cada" required error={errors.recurrence_interval} help="Intervalo em meses.">
                <input
                  id="recurrence_interval"
                  name="recurrence_interval"
                  type="number"
                  min={1}
                  max={120}
                  value={customInterval}
                  onChange={event => setCustomInterval(Number(event.target.value))}
                  {...errorProps("recurrence_interval")}
                />
              </FormField>
            ) : <input type="hidden" name="recurrence_interval" value="1" />}
            <FormField name="start_date" label="Data de início / primeira competência" required error={errors.start_date}>
              <input
                id="start_date"
                name="start_date"
                type="date"
                value={startDate}
                onChange={event => setStartDate(event.target.value)}
                {...errorProps("start_date")}
              />
            </FormField>
            <FormField name="due_day" label="Dia de vencimento" required error={errors.due_day}>
              <input
                id="due_day"
                name="due_day"
                type="number"
                min={1}
                max={31}
                value={dueDay}
                onChange={event => setDueDay(event.target.value)}
                placeholder="Ex.: 10"
                {...errorProps("due_day")}
              />
            </FormField>
            <FormField name="category_id" label="Categoria">
              <select id="category_id" name="category_id" defaultValue={commitment?.categoryId ?? ""}>
                <option value="">Sem categoria</option>
                {categories.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </FormField>
            <FormField
              name="account_id"
              label="Conta de pagamento / origem"
              help={paymentMethod === "payroll"
                ? "Não é necessária para descontos feitos diretamente na folha."
                : undefined}
            >
              <select
                id="account_id"
                name="account_id"
                defaultValue={commitment?.accountId ?? ""}
                disabled={paymentMethod === "payroll"}
              >
                <option value="">Nenhuma conta</option>
                {accounts.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
              </select>
            </FormField>
            <FormField name="description" label="Observação" wide>
              <textarea
                id="description"
                name="description"
                maxLength={1000}
                defaultValue={commitment?.description ?? ""}
                placeholder="Contexto opcional para lembrar depois"
              />
            </FormField>
          </div>
        </section>

        <section className="commitment-form-section">
          <header>
            <span>2</span>
            <div><h3>Regras e vínculos</h3><p>Escolha como este compromisso participa do planejamento.</p></div>
          </header>
          <div className="commitment-form-grid">
            <FormField name="person_id" label="Pessoa ou dependente">
              <select
                id="person_id"
                name="person_id"
                value={personId}
                onChange={event => {
                  setPersonId(event.target.value);
                  if (event.target.value) setAnalysisGroupId("");
                }}
              >
                <option value="">Sem vínculo</option>
                {people.map(row => <option key={row.person.id} value={row.person.id}>{row.person.name}</option>)}
              </select>
            </FormField>
            <FormField
              name="analysis_group_id"
              label="Contexto financeiro"
              help="Casa é um contexto financeiro, não uma pessoa."
            >
              <select
                id="analysis_group_id"
                name="analysis_group_id"
                value={analysisGroupId}
                onChange={event => {
                  setAnalysisGroupId(event.target.value);
                  if (event.target.value) setPersonId("");
                }}
              >
                <option value="">Minha conta recorrente</option>
                {householdGroups.map(option => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
            </FormField>
            <div className="commitment-toggle-cell">
              <label className="toggle-field">
                <input
                  type="checkbox"
                  name="shared_expense_enabled"
                  checked={sharedExpense}
                  onChange={event => setSharedExpense(event.target.checked)}
                />
                <span>
                  <b>Despesa compartilhada</b>
                  <small>Separe beneficiário, sua parte e o valor reembolsável.</small>
                </span>
              </label>
            </div>
            {sharedExpense ? (
              <fieldset className="commitment-shared-fields wide">
                <legend>Responsabilidade financeira</legend>
                <div className="commitment-form-grid">
                  <FormField name="beneficiary_person_id" label="Beneficiário" required>
                    <select
                      id="beneficiary_person_id"
                      name="beneficiary_person_id"
                      defaultValue={commitment?.beneficiaryPersonId ??
                        initialPersonId ?? item?.people[0]?.id ?? ""}
                      required
                    >
                      <option value="">Selecione</option>
                      {people.filter(row => row.person.relationType !== "self")
                        .map(row => (
                          <option key={row.person.id} value={row.person.id}>
                            {row.person.name}
                          </option>
                        ))}
                    </select>
                  </FormField>
                  <FormField name="user_responsibility_type" label="Minha forma de divisão" required>
                    <select
                      id="user_responsibility_type"
                      name="user_responsibility_type"
                      value={userResponsibilityType ?? "fixed_amount"}
                      onChange={event => setUserResponsibilityType(
                        event.target.value as "full" | "percentage" | "fixed_amount",
                      )}
                    >
                      <option value="fixed_amount">Valor fixo</option>
                      <option value="percentage">Percentual</option>
                      <option value="full">Valor total</option>
                    </select>
                  </FormField>
                  <FormField
                    name="user_responsibility_value"
                    label={userResponsibilityType === "percentage"
                      ? "Percentual assumido por mim" : "Parte assumida por mim"}
                    required
                  >
                    <input
                      id="user_responsibility_value"
                      name="user_responsibility_value"
                      inputMode="decimal"
                      defaultValue={commitment?.userResponsibilityValue == null
                        ? userResponsibilityType === "full" ? "100" : ""
                        : String(commitment.userResponsibilityValue).replace(".", ",")}
                      placeholder={userResponsibilityType === "percentage"
                        ? "50" : "150,00"}
                      required
                    />
                  </FormField>
                  <FormField name="reimbursement_person_id" label="Pessoa responsável pelo reembolso" required>
                    <select
                      id="reimbursement_person_id"
                      name="reimbursement_person_id"
                      defaultValue={commitment?.reimbursementPersonId ??
                        initialPersonId ?? item?.people[0]?.id ?? ""}
                      required
                    >
                      <option value="">Selecione</option>
                      {people.filter(row => row.person.relationType !== "self")
                        .map(row => (
                          <option key={row.person.id} value={row.person.id}>
                            {row.person.name}
                          </option>
                        ))}
                    </select>
                  </FormField>
                  <FormField name="reimbursement_allocation_type" label="Parte reembolsável" required>
                    <select
                      id="reimbursement_allocation_type"
                      name="reimbursement_allocation_type"
                      value={reimbursementType ?? "remainder"}
                      onChange={event => {
                        setReimbursementType(
                          event.target.value as
                            "full" | "percentage" | "fixed_amount" | "remainder",
                        );
                        if (event.target.value === "remainder") {
                          setReimbursementValue("0");
                        }
                      }}
                    >
                      <option value="remainder">Valor restante</option>
                      <option value="fixed_amount">Valor fixo</option>
                      <option value="percentage">Percentual</option>
                      <option value="full">Valor total</option>
                    </select>
                  </FormField>
                  <FormField
                    name="reimbursement_allocation_value"
                    label={reimbursementType === "remainder"
                      ? "Restante calculado automaticamente"
                      : "Valor ou percentual reembolsável"}
                    required
                  >
                    <input
                      id="reimbursement_allocation_value"
                      name="reimbursement_allocation_value"
                      inputMode="decimal"
                      value={reimbursementType === "remainder"
                        ? "0" : reimbursementValue}
                      onChange={event => setReimbursementValue(event.target.value)}
                      readOnly={reimbursementType === "remainder"}
                      required
                    />
                  </FormField>
                  <p className="commitment-shared-help wide">
                    O valor bruto continuará visível. Pix recebidos reduzirão
                    apenas o custo líquido, sem virar receita.
                  </p>
                </div>
              </fieldset>
            ) : (
              <>
                <input type="hidden" name="beneficiary_person_id" value="" />
                <input type="hidden" name="user_responsibility_type" value="" />
                <input type="hidden" name="user_responsibility_value" value="" />
                <input type="hidden" name="reimbursement_person_id" value="" />
                <input type="hidden" name="reimbursement_allocation_type" value="" />
                <input type="hidden" name="reimbursement_allocation_value" value="" />
              </>
            )}
            <FormField name="payment_method" label="Forma de pagamento">
              <select
                id="payment_method"
                name="payment_method"
                value={paymentMethod}
                onChange={event => setPaymentMethod(event.target.value)}
              >
                <option value="">Não definida</option>
                <option value="transfer">Conta corrente</option>
                <option value="credit_card">Cartão</option>
                <option value="bank_debit">Débito automático</option>
                <option value="payroll">Desconto em folha</option>
                <option value="boleto">Boleto</option>
                <option value="other">Manual</option>
              </select>
            </FormField>
            {paymentMethod === "payroll" ? (
              <p className="payroll-form-help">
                Esse valor já é retirado antes do salário líquido entrar na
                conta. Ele aparecerá nas análises, mas não será descontado
                novamente do saldo disponível.
              </p>
            ) : null}
            {paymentMethod === "credit_card" ? (
              <>
                <FormField name="card_id" label="Cartão" required error={errors.card_id}>
                  <select
                    id="card_id"
                    name="card_id"
                    defaultValue={commitment?.cardId ?? ""}
                    {...errorProps("card_id")}
                  >
                    <option value="">Selecione o cartão</option>
                    {cards.map(option => <option key={option.id} value={option.id}>{option.name}</option>)}
                  </select>
                </FormField>
                <div className="commitment-toggle-cell">
                  <ToggleField
                    name="same_invoice"
                    label="Sempre na mesma fatura"
                    help="Mantém a projeção vinculada ao mesmo cartão."
                    defaultChecked={commitment?.sameInvoice}
                  />
                </div>
              </>
            ) : <input type="hidden" name="card_id" value="" />}
            <div className="commitment-toggle-cell">
              <ToggleField
                name="include_in_monthly_budget"
                label="Participa do orçamento mensal"
                help="Inclui o valor nos resumos de planejamento."
                defaultChecked={commitment?.includeInMonthlyBudget ?? true}
              />
            </div>
            <div className="commitment-toggle-cell">
              <ToggleField
                name="generates_future_projections"
                label="Considerar em compromissos futuros"
                help="Mantém automaticamente apenas o mês vigente e o próximo."
                defaultChecked={commitment?.generatesFutureProjections ?? true}
              />
            </div>
            <fieldset className="commitment-tags wide">
              <legend>Marcadores</legend>
              <div>
                {tagOptions.map(([value, label]) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      name="tags"
                      value={value}
                      defaultChecked={commitment?.tags?.includes(value)}
                    />
                    <span>{label}</span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        </section>

        <section className="commitment-projection">
          <header>
            <span>3</span>
            <div><h3>Projeção</h3><p>Resumo do que o Atlas criará.</p></div>
          </header>
          <dl>
            <div><dt>Frequência</dt><dd>{frequencyLabels[frequency] ?? "—"}</dd></div>
            <div><dt>Data inicial</dt><dd>{startDate ? new Intl.DateTimeFormat("pt-BR", { timeZone: "UTC" }).format(new Date(`${startDate}T12:00:00Z`)) : "—"}</dd></div>
            <div><dt>Vencimento</dt><dd>{dueDay ? `Dia ${dueDay}` : "—"}</dd></div>
            <div><dt>Horizonte</dt><dd>Até o próximo mês</dd></div>
            <div><dt>Ocorrências no próximo mês</dt><dd>{estimate}</dd></div>
          </dl>
          <label className={`projection-confirmation${errors.projection_confirmation ? " invalid" : ""}`}>
            <input
              name="projection_confirmation"
              type="checkbox"
              defaultChecked={Boolean(item)}
              {...errorProps("projection_confirmation")}
            />
            <span>
              <b>Confirmo os dados e a geração da próxima previsão *</b>
              <small>
                A recorrência continuará ativa, mas o Atlas manterá somente o
                mês vigente e o seguinte.
              </small>
            </span>
          </label>
          {errors.projection_confirmation ? (
            <small id="projection_confirmation-error" className="field-error">
              {errors.projection_confirmation}
            </small>
          ) : null}
        </section>
      </AtlasModalBody>

      <AtlasModalFooter>
        <button type="button" className="finance-button secondary" disabled={saving} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="finance-button" disabled={saving}>
          {saving ? "Salvando…" : "Salvar compromisso"}
        </button>
      </AtlasModalFooter>
    </form>
  );
}
