"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ArrowIcon } from "@/components/atlas/icons";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/types/atlas";

type OnboardingProfile = Pick<
  Profile,
  "id" | "full_name" | "preferred_name" | "phone" | "locale" | "timezone"
>;

export function OnboardingForm({ profile }: { profile: OnboardingProfile }) {
  const router = useRouter();
  const [fullName, setFullName] = useState(profile.full_name ?? "");
  const [preferredName, setPreferredName] = useState(profile.preferred_name ?? "");
  const [phone, setPhone] = useState(profile.phone ?? "");
  const [locale, setLocale] = useState(profile.locale || "pt-BR");
  const [timezone, setTimezone] = useState(profile.timezone || "America/Sao_Paulo");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (loading) return;

    const normalizedFullName = fullName.trim();
    if (normalizedFullName.length < 2) {
      setError("Informe seu nome completo.");
      return;
    }

    const normalizedPreferredName =
      preferredName.trim() || normalizedFullName.split(/\s+/)[0];

    setError("");
    setLoading(true);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        full_name: normalizedFullName,
        preferred_name: normalizedPreferredName,
        phone: phone.trim() || null,
        locale,
        timezone,
        onboarding_completed: true,
      })
      .eq("id", profile.id);

    if (updateError) {
      setError("Não foi possível concluir sua configuração. Tente novamente.");
      setLoading(false);
      return;
    }

    router.replace("/dashboard");
  }

  return (
    <form onSubmit={submit} className="mt-8 grid gap-5" noValidate>
      <OnboardingField
        id="full-name"
        label="Nome completo"
        value={fullName}
        onChange={(value) => { setFullName(value); setError(""); }}
        autoComplete="name"
        required
      />
      <OnboardingField
        id="preferred-name"
        label="Como prefere ser chamado"
        value={preferredName}
        onChange={(value) => { setPreferredName(value); setError(""); }}
        autoComplete="nickname"
        placeholder="Usaremos o primeiro nome se ficar vazio"
      />
      <OnboardingField
        id="phone"
        label="Telefone (opcional)"
        value={phone}
        onChange={(value) => { setPhone(value); setError(""); }}
        autoComplete="tel"
        inputMode="tel"
      />

      <div className="grid gap-5 sm:grid-cols-2">
        <label className="grid gap-2 text-sm font-medium text-[var(--atlas-text)]" htmlFor="locale">
          Idioma
          <select id="locale" value={locale} onChange={(event) => setLocale(event.target.value)} className="h-12 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] px-4 text-sm outline-none focus:border-[var(--atlas-blue)] focus:shadow-[var(--atlas-focus)]">
            <option value="pt-BR">Português (Brasil)</option>
          </select>
        </label>
        <label className="grid gap-2 text-sm font-medium text-[var(--atlas-text)]" htmlFor="timezone">
          Fuso horário
          <select id="timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="h-12 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] px-4 text-sm outline-none focus:border-[var(--atlas-blue)] focus:shadow-[var(--atlas-focus)]">
            <option value="America/Sao_Paulo">Brasília</option>
          </select>
        </label>
      </div>

      {error ? <p role="alert" className="text-center text-sm text-[var(--atlas-error)]">{error}</p> : null}

      <button type="submit" disabled={loading} className="atlas-primary mt-1 disabled:cursor-wait">
        {loading ? (
          <><span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" /> Salvando…</>
        ) : (
          <>Concluir configuração <ArrowIcon className="size-[18px]" /></>
        )}
      </button>
    </form>
  );
}

function OnboardingField({
  id,
  label,
  value,
  onChange,
  autoComplete,
  placeholder,
  inputMode,
  required = false,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: string;
  placeholder?: string;
  inputMode?: "tel";
  required?: boolean;
}) {
  return (
    <label className="grid gap-2 text-sm font-medium text-[var(--atlas-text)]" htmlFor={id}>
      {label}
      <input id={id} value={value} onChange={(event) => onChange(event.target.value)} autoComplete={autoComplete} inputMode={inputMode} placeholder={placeholder} required={required} className="h-12 rounded-xl border border-[var(--atlas-border)] bg-[var(--atlas-surface-solid)] px-4 text-sm font-normal outline-none transition focus:border-[var(--atlas-blue)] focus:shadow-[var(--atlas-focus)]" />
    </label>
  );
}
