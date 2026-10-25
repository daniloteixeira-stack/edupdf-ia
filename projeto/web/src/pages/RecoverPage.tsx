import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { Alert, AuthShell, Steps } from "../components/AuthShell";
import { OtpInput } from "../components/OtpInput";
import { PasswordFields, passwordIsValid } from "../components/PasswordFields";
import { PLATFORM } from "../lib/platform";

/** Recuperação de senha também por código de 6 dígitos (funciona na web e no desktop). */
export function RecoverPage() {
  const navigate = useNavigate();
  const { recordSignIn } = useAuth();
  const [step, setStep] = useState(0);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const send = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase());
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setStep(1);
  };

  const verify = async (token = code) => {
    setError(null);
    setBusy(true);
    const { error } = await supabase.auth.verifyOtp({ email: email.trim().toLowerCase(), token, type: "recovery" });
    setBusy(false);
    if (error) return setError(friendlyError(error));
    setStep(2);
  };

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordIsValid(password, confirm)) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      await supabase.rpc("edu_log_access", { p_event: "password_changed", p_platform: PLATFORM, p_user_agent: navigator.userAgent });
      await recordSignIn("sign_in");
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Recuperar senha" footer={<Link to="/login">Voltar ao login</Link>}>
      <Steps current={step} labels={["E-mail", "Código", "Nova senha"]} />
      <Alert>{error}</Alert>
      {step === 0 && (
        <form onSubmit={send} className="stack">
          <label className="field">
            <span>E-mail da conta</span>
            <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </label>
          <button className="btn btn-primary btn-block" disabled={busy}>
            {busy ? "Enviando…" : "Enviar código"}
          </button>
        </form>
      )}
      {step === 1 && (
        <div className="stack">
          <p className="muted">Se o e-mail estiver cadastrado, você receberá um código de 6 dígitos.</p>
          <OtpInput value={code} onChange={setCode} disabled={busy} onComplete={(v) => void verify(v)} />
          <button className="btn btn-primary btn-block" disabled={busy || code.length !== 6} onClick={() => void verify()}>
            Confirmar código
          </button>
        </div>
      )}
      {step === 2 && (
        <form onSubmit={save} className="stack">
          <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
          <button className="btn btn-primary btn-block" disabled={busy || !passwordIsValid(password, confirm)}>
            Salvar nova senha
          </button>
        </form>
      )}
    </AuthShell>
  );
}
