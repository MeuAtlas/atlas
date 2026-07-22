"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

import { ArrowIcon, EyeIcon, EyeOffIcon, LockIcon, ShieldIcon } from "@/components/atlas/icons";
import { createClient } from "@/lib/supabase/client";

import { FormField } from "./form-field";

export function UpdatePasswordCard() {
  const router = useRouter();
  const redirectTimeoutRef = useRef<number | null>(null);
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    return () => {
      if (redirectTimeoutRef.current !== null) {
        window.clearTimeout(redirectTimeoutRef.current);
      }
    };
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSuccess("");
    if (password.length < 8) return setError("Use uma senha com pelo menos 8 caracteres.");
    if (password !== confirmation) return setError("As senhas não coincidem.");

    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) return setError("Não foi possível atualizar sua senha. Solicite um novo link.");

    setSuccess("Senha atualizada com segurança.");
    redirectTimeoutRef.current = window.setTimeout(() => {
      redirectTimeoutRef.current = null;
      router.replace("/auth/continue");
    }, 900);
  }

  const revealButton = (
    <button type="button" onClick={() => setShowPassword((value) => !value)} className="absolute right-1.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-[var(--atlas-muted)] hover:bg-[var(--atlas-blue-soft)]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"}>
      {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
    </button>
  );

  return (
    <section className="atlas-auth-card atlas-card-enter">
      <div className="mb-7 text-center">
        <h1 className="text-[28px] font-semibold tracking-[-.035em] text-[var(--atlas-text)] sm:text-[32px]">Criar nova senha</h1>
        <p className="mt-2 text-[15px] leading-6 text-[var(--atlas-muted)]">Escolha uma senha segura para continuar no Atlas.</p>
      </div>
      <form onSubmit={submit} noValidate>
        <FormField id="new-password" type={showPassword ? "text" : "password"} label="Nova senha" placeholder="Mínimo de 8 caracteres" autoComplete="new-password" value={password} disabled={loading} icon={<LockIcon className="size-5" />} trailing={revealButton} onChange={(event) => { setPassword(event.target.value); setError(""); }} />
        <FormField id="confirm-password" type={showPassword ? "text" : "password"} label="Confirmar senha" placeholder="Digite novamente" autoComplete="new-password" value={confirmation} disabled={loading} icon={<LockIcon className="size-5" />} onChange={(event) => { setConfirmation(event.target.value); setError(""); }} />
        <div className={`mb-3 min-h-5 text-center text-sm ${success ? "text-[var(--atlas-success)]" : "text-[var(--atlas-error)]"}`} role={error ? "alert" : undefined} aria-live="polite">{success || error}</div>
        <button type="submit" disabled={loading || Boolean(success)} className="flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] bg-[var(--atlas-blue)] text-[15px] font-semibold text-white shadow-[0_10px_24px_rgba(51,92,255,.24)] transition hover:-translate-y-px hover:bg-[var(--atlas-blue-hover)] disabled:cursor-not-allowed disabled:opacity-65">
          {loading ? <><span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" /> Atualizando…</> : <>Salvar nova senha <ArrowIcon className="size-[18px]" /></>}
        </button>
      </form>
      <div className="mt-7 flex items-center justify-center gap-2 border-t border-[var(--atlas-border)] pt-5 text-xs text-[var(--atlas-muted)]"><ShieldIcon className="size-4 text-[var(--atlas-blue)]" /> Link de recuperação protegido</div>
    </section>
  );
}
