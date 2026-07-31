"use client";

import {
  type ChangeEvent,
  type FocusEvent,
  type FormEvent,
  useRef,
  useState,
} from "react";
import { saveFinancialPersonForm } from "@/modules/finance/commitments-actions";
import type { CommitmentsOverview } from "@/modules/finance/commitments-query";
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

type PersonRow = CommitmentsOverview["people"][number];

export const personRelationOptions = [
  ["daughter", "Filha"],
  ["son", "Filho"],
  ["spouse", "Cônjuge"],
  ["ex_spouse", "Ex-cônjuge"],
  ["father", "Pai"],
  ["mother", "Mãe"],
  ["other_dependent", "Outro dependente"],
  ["other", "Outro"],
] as const;

const dependentRelations = new Set(["daughter", "son", "other_dependent"]);
const normalizedRelation: Record<string, string> = {
  child: "daughter",
  wife: "spouse",
  husband: "spouse",
  parent: "father",
  dependent: "other_dependent",
  family: "other",
  self: "other",
};

function validatePerson(form: HTMLFormElement) {
  const data = new FormData(form);
  const errors: FieldErrors = {};
  if (!String(data.get("name") ?? "").trim()) {
    errors.name = "Preencha o nome da pessoa.";
  }
  if (!personRelationOptions.some(([value]) => value === data.get("relation_type"))) {
    errors.relation_type = "Selecione a relação.";
  }
  return errors;
}

export function PersonForm({
  workspaceId,
  onClose,
  onSaved,
  item,
}: {
  workspaceId: string;
  onClose: () => void;
  onSaved: (message: string) => void;
  item?: PersonRow;
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const initialRelation = item?.person.relationType
    ? normalizedRelation[item.person.relationType] ?? item.person.relationType
    : "";
  const [relation, setRelation] = useState(initialRelation);
  const [dependent, setDependent] = useState(item?.person.isDependent ?? false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [formMessage, setFormMessage] = useState("");
  const [attempted, setAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleRelation = (value: string) => {
    setRelation(value);
    if (dependentRelations.has(value)) setDependent(true);
  };

  const handleBlur = (event: FocusEvent<HTMLFormElement>) => {
    const name = (event.target as unknown as HTMLInputElement).name;
    if (!["name", "relation_type"].includes(name)) return;
    const next = validatePerson(event.currentTarget);
    setErrors(current => ({ ...current, [name]: next[name] ?? "" }));
  };

  const handleChange = (event: ChangeEvent<HTMLFormElement>) => {
    if (!attempted) return;
    const name = (event.target as unknown as HTMLInputElement).name;
    if (!name) return;
    const next = validatePerson(event.currentTarget);
    setErrors(current => ({ ...current, [name]: next[name] ?? "" }));
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setAttempted(true);
    setFormMessage("");
    const clientErrors = validatePerson(event.currentTarget);
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
    const result = await saveFinancialPersonForm(new FormData(event.currentTarget));
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

  return (
    <form
      ref={formRef}
      className="commitment-single-form person-single-form"
      noValidate
      onSubmit={handleSubmit}
      onBlur={handleBlur}
      onChange={handleChange}
    >
      <input type="hidden" name="workspace_id" value={workspaceId} />
      {item ? <input type="hidden" name="person_id" value={item.person.id} /> : null}
      <AtlasModalHeader>
        <div>
          <p className="eyebrow">Pessoas e dependentes</p>
          <h2>{item ? "Editar pessoa" : "Nova pessoa"}</h2>
          <p className="atlas-modal-subtitle">
            Use o vínculo para acompanhar compromissos e gastos individuais.
          </p>
        </div>
        <AtlasModalClose />
      </AtlasModalHeader>
      <AtlasModalBody className="commitment-single-body">
        <p className="required-legend">Campos marcados com <b>*</b> são obrigatórios.</p>
        <FormErrorSummary errors={errors} formMessage={formMessage} />
        <section className="commitment-form-section person-form-section">
          <div className="commitment-form-grid">
            <FormField name="name" label="Nome" required error={errors.name} wide>
              <input
                id="name"
                name="name"
                maxLength={120}
                defaultValue={item?.person.name ?? ""}
                placeholder="Nome da pessoa"
                aria-invalid={errors.name ? true : undefined}
                aria-describedby={errors.name ? "name-error" : undefined}
              />
            </FormField>
            <FormField name="relation_type" label="Relação" required error={errors.relation_type} wide>
              <select
                id="relation_type"
                name="relation_type"
                value={relation}
                onChange={event => handleRelation(event.target.value)}
                aria-invalid={errors.relation_type ? true : undefined}
                aria-describedby={errors.relation_type ? "relation_type-error" : undefined}
              >
                <option value="">Selecione</option>
                {personRelationOptions.map(([value, label]) =>
                  <option key={value} value={value}>{label}</option>
                )}
              </select>
            </FormField>
            <div className="commitment-toggle-cell wide">
              <ToggleField
                name="is_dependent"
                label="É dependente financeiro?"
                help={dependentRelations.has(relation)
                  ? "Ativado automaticamente pela relação selecionada."
                  : "Ative para incluir esta pessoa nos totais de dependentes."}
                checked={dependent}
                onChange={setDependent}
              />
            </div>
            <FormField name="notes" label="Observação" wide>
              <textarea
                id="notes"
                name="notes"
                maxLength={1000}
                defaultValue={item?.person.notes ?? ""}
                placeholder="Informação opcional"
              />
            </FormField>
          </div>
        </section>
      </AtlasModalBody>
      <AtlasModalFooter>
        <button type="button" className="finance-button secondary" disabled={saving} onClick={onClose}>
          Cancelar
        </button>
        <button type="submit" className="finance-button" disabled={saving}>
          {saving ? "Salvando…" : "Salvar pessoa"}
        </button>
      </AtlasModalFooter>
    </form>
  );
}
