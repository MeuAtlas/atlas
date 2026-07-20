"use client";

import { useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { AtlasMark } from "@/components/atlas/atlas-mark";
import { ArrowIcon, BackIcon, EyeIcon, EyeOffIcon, KeyIcon, LockIcon, MailIcon, ShieldIcon } from "@/components/atlas/icons";
import { createClient } from "@/lib/supabase/client";

import { FormField } from "./form-field";

type FieldErrors = { email?: string; password?: string };
type View = "login" | "recovery";

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: string) {
  if (!email.trim()) return "Informe seu e-mail.";
  if (!emailPattern.test(email)) return "Digite um e-mail válido.";
}

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login credentials") || normalized.includes("email not confirmed")) {
    return "E-mail ou senha incorretos.";
  }
  if (normalized.includes("rate limit") || normalized.includes("too many")) {
    return "Muitas tentativas. Aguarde um momento e tente novamente.";
  }
  return "Não foi possível entrar agora. Tente novamente.";
}

export function LoginCard() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [view, setView] = useState<View>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [remember, setRemember] = useState(true);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [notice, setNotice] = useState(() =>
    searchParams.get("error") === "invalid_recovery_link"
      ? "Este link expirou ou não é válido. Solicite novas instruções."
      : "",
  );
  const [submitting, setSubmitting] = useState(false);

  function clearFeedback(field?: keyof FieldErrors) {
    setNotice("");
    if (field) setErrors((current) => ({ ...current, [field]: undefined }));
  }

  async function handleLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;

    const nextErrors: FieldErrors = {
      email: validateEmail(email),
      password: password ? undefined : "Informe sua senha.",
    };
    setErrors(nextErrors);
    setNotice("");
    if (nextErrors.email || nextErrors.password) return;

    setSubmitting(true);
    const supabase = createClient();
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });

    if (error) {
      setNotice(friendlyAuthError(error.message));
      setSubmitting(false);
      return;
    }

    const requested = searchParams.get("next");
    const destination = requested?.startsWith("/") && !requested.startsWith("//") ? requested : "/dashboard";
    router.replace(destination);
    router.refresh();
  }

  async function handleRecovery(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const emailError = validateEmail(email);
    setErrors({ email: emailError });
    setNotice("");
    if (emailError) return;

    setSubmitting(true);
    const supabase = createClient();
    await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/callback?next=/update-password`,
    });
    setSubmitting(false);
    setNotice("Enviamos as instruções de recuperação, caso exista uma conta com esse e-mail.");
  }

  const isRecovery = view === "recovery";

  return (
    <section className="atlas-auth-card atlas-card-enter">
      <div className="atlas-card-heading">
        <div className="atlas-halo">
          <AtlasMark className="atlas-halo-mark" decorative />
        </div>
        <h1 className="atlas-login-title">
          {isRecovery ? "Recuperar acesso" : "Entrar no Atlas"}
        </h1>
        <p className="atlas-login-subtitle">
          {isRecovery ? "Receba um link seguro para redefinir sua senha." : "Seu espaço pessoal, privado e seguro."}
        </p>
      </div>

      {isRecovery ? (
        <form onSubmit={handleRecovery} noValidate>
          <FormField id="recovery-email" type="email" label="E-mail" placeholder="Digite seu e-mail" autoComplete="email" value={email} error={errors.email} disabled={submitting} icon={<MailIcon className="size-5" />} onChange={(event) => { setEmail(event.target.value); clearFeedback("email"); }} />
          <StatusMessage message={notice} success={notice.startsWith("Enviamos")} />
          <PrimaryButton loading={submitting} label="Enviar instruções" />
          <button type="button" onClick={() => { setView("login"); setNotice(""); setErrors({}); }} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-[14px] text-sm font-medium text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-blue-soft)] hover:text-[var(--atlas-text)]">
            <BackIcon className="size-4" /> Voltar ao login
          </button>
        </form>
      ) : (
        <form onSubmit={handleLogin} noValidate>
          <FormField id="email" type="email" label="E-mail" placeholder="Digite seu e-mail" autoComplete="email" value={email} error={errors.email} disabled={submitting} icon={<MailIcon className="size-5" />} onChange={(event) => { setEmail(event.target.value); clearFeedback("email"); }} />
          <FormField id="password" type={showPassword ? "text" : "password"} label="Senha" placeholder="Digite sua senha" autoComplete="current-password" value={password} error={errors.password} disabled={submitting} icon={<LockIcon className="size-5" />} onChange={(event) => { setPassword(event.target.value); clearFeedback("password"); }} trailing={
            <button type="button" onClick={() => setShowPassword((current) => !current)} className="absolute right-1.5 top-1/2 grid size-10 -translate-y-1/2 place-items-center rounded-lg text-[var(--atlas-muted)] transition hover:bg-[var(--atlas-blue-soft)] hover:text-[var(--atlas-text)]" aria-label={showPassword ? "Ocultar senha" : "Mostrar senha"} title={showPassword ? "Ocultar senha" : "Mostrar senha"}>
              {showPassword ? <EyeOffIcon className="size-5" /> : <EyeIcon className="size-5" />}
            </button>
          } />

          <div className="atlas-login-options">
            <label className="flex cursor-pointer items-center gap-2.5 text-[var(--atlas-muted)]">
              <input type="checkbox" checked={remember} onChange={(event) => setRemember(event.target.checked)} className="size-4 rounded border-[var(--atlas-border)] accent-[var(--atlas-blue)]" />
              <span>Manter conectado</span>
            </label>
            <button type="button" onClick={() => { setView("recovery"); setNotice(""); setErrors({}); }} className="font-medium text-[var(--atlas-blue)] underline-offset-4 hover:underline">Esqueci minha senha</button>
          </div>

          <StatusMessage message={notice} />
          <PrimaryButton loading={submitting} label="Entrar" />
          <button type="button" disabled={submitting} onClick={() => setNotice("Acesso por código estará disponível em breve.")} className="atlas-secondary-button">
            <KeyIcon className="size-[18px] text-[var(--atlas-muted)]" /> Acessar com código
          </button>
        </form>
      )}

      <div className="atlas-security-notice">
        <ShieldIcon className="size-4 shrink-0 text-[var(--atlas-blue)]" />
        <span>Acesso restrito aos usuários autorizados</span>
      </div>
    </section>
  );
}

function StatusMessage({ message, success = false }: { message: string; success?: boolean }) {
  if (!message) return null;
  return <div className={`atlas-status-message ${success ? "text-[var(--atlas-success)]" : "text-[var(--atlas-error)]"}`} role={!success ? "alert" : undefined} aria-live="polite">{message}</div>;
}

function PrimaryButton({ loading, label }: { loading: boolean; label: string }) {
  return (
    <button type="submit" disabled={loading} className="atlas-primary">
      {loading ? <><span className="size-4 animate-spin rounded-full border-2 border-white/35 border-t-white" /><span>Processando…</span></> : <><span>{label}</span><ArrowIcon className="size-[18px]" /></>}
    </button>
  );
}
