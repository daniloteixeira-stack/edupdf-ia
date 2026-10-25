import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import { DESKTOP_DOWNLOAD_URL, IS_DESKTOP } from "../lib/platform";
import { useAuth } from "../auth/AuthProvider";
import { Alert, AuthShell, Steps } from "../components/AuthShell";
import { OtpInput } from "../components/OtpInput";
import { PasswordFields, passwordIsValid } from "../components/PasswordFields";

type Step = "email" | "code" | "password";
const STEP_INDEX: Record<Step, number> = { email: 0, code: 1, password: 2 };
const RESEND_SECONDS = 60;

/**
 * Cadastro obrigatório pelo app desktop:
 * e-mail → código OTP de 6 dígitos → criação da senha.
 */
export function SignupPage() {
  const navigate = useNavigate();
  const { recordSignIn } = useAuth();
  const [step, setStep] = useState<Step>("email");
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  if (!IS_DESKTOP) {
    return (
      <AuthShell title="Cadastro pelo aplicativo Windows" subtitle="Por segurança, novas contas são criadas apenas no aplicativo instalado.">
        {DESKTOP_DOWNLOAD_URL ? (
          <a className="btn btn-primary btn-block" href={DESKTOP_DOWNLOAD_URL}>
            Baixar o instalador (.exe)
          </a>
        ) : (
          <Alert kind="info">Peça ao seu professor o instalador do aplicativo.</Alert>
        )}
        <p className="center">
          Já tem conta? <Link to="/login">Entrar</Link>
        </p>
      </AuthShell>
    );
  }

  const sendCode = async () => {
    setError(null);
    setInfo(null);
    setBusy(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim().toLowerCase(),
      options: { shouldCreateUser: true, data: { app: "edupdf", platform: "desktop", full_name: fullName.trim() } },
    });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setCode("");
    setCooldown(RESEND_SECONDS);
    setStep("code");
    setInfo(`Enviamos um código de 6 dígitos para ${email.trim()}. Confira também o spam.`);
  };

  const onEmail = (e: FormEvent) => {
    e.preventDefault();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim())) return setError("Digite um e-mail válido.");
    void sendCode();
  };

  const verify = async (token = code) => {
    if (token.length !== 6) return setError("Digite os 6 dígitos.");
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "email" });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    // E-mail já usado por outro sistema do mesmo projeto Supabase: sem perfil EduPDF.
    const { data: s } = await supabase.auth.getSession();
    const { data: prof } = s.session
      ? await supabase.from("edu_profiles").select("id").eq("id", s.session.user.id).maybeSingle()
      : { data: null };
    if (!prof) {
      await supabase.auth.signOut();
      setStep("email");
      return setError("Este e-mail já está ligado a outra conta e não pode ser usado aqui. Use outro e-mail.");
    }
    setInfo("E-mail confirmado! Agora crie sua senha de acesso.");
    setStep("password");
  };

  const savePassword = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordIsValid(password, confirm)) return setError("Confira os requisitos da senha.");
    setError(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password, data: { full_name: fullName.trim() } });
      if (error) throw error;
      if (fullName.trim()) {
        const { data: s } = await supabase.auth.getSession();
        if (s.session) await supabase.from("edu_profiles").update({ full_name: fullName.trim() }).eq("id", s.session.user.id);
      }
      await recordSignIn("signup");
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Criar conta"
      subtitle="Leva menos de um minuto."
      footer={
        <>
          Já tem conta? <Link to="/login">Entrar</Link>
        </>
      }
    >
      <Steps current={STEP_INDEX[step]} labels={["E-mail", "Código", "Senha"]} />
      <Alert kind="info">{info}</Alert>
      <Alert>{error}</Alert>

      {step === "email" && (
        <form onSubmit={onEmail} className="stack">
          <label className="field">
            <span>Nome completo</span>
            <input value={fullName} onChange={(e) => setFullName(e.target.value)} autoComplete="name" required />
          </label>
          <label className="field">
            <span>E-mail</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
          </label>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Enviando…" : "Enviar código"}
          </button>
        </form>
      )}

      {step === "code" && (
        <form
          className="stack"
          onSubmit={(e) => {
            e.preventDefault();
            void verify();
          }}
        >
          <OtpInput value={code} onChange={setCode} disabled={busy} onComplete={(v) => void verify(v)} />
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6}>
            {busy ? "Verificando…" : "Confirmar código"}
          </button>
          <div className="row between">
            <button type="button" className="btn-link" onClick={() => setStep("email")}>
              Trocar e-mail
            </button>
            <button type="button" className="btn-link" disabled={cooldown > 0 || busy} onClick={() => void sendCode()}>
              {cooldown > 0 ? `Reenviar em ${cooldown}s` : "Reenviar código"}
            </button>
          </div>
        </form>
      )}

      {step === "password" && (
        <form onSubmit={savePassword} className="stack">
          <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          <button className="btn btn-primary btn-block" disabled={busy || !passwordIsValid(password, confirm)}>
            {busy ? "Salvando…" : "Criar senha e entrar"}
          </button>
        </form>
      )}
    </AuthShell>
  );
}
