import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, friendlyError, supabaseConfigured } from "../lib/supabase";
import { IS_DESKTOP } from "../lib/platform";
import { useAuth } from "../auth/AuthProvider";
import { Alert, AuthShell } from "../components/AuthShell";

export function LoginPage() {
  const navigate = useNavigate();
  const { recordSignIn, notice, setNotice } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const { error } = await supabase.auth.signInWithPassword({ email: email.trim().toLowerCase(), password });
      if (error) throw error;
      await recordSignIn("sign_in");
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Entrar"
      subtitle="Acesse seus módulos de estudo."
      footer={
        <>
          Novo por aqui? <Link to="/cadastro">{IS_DESKTOP ? "Criar conta" : "Como criar conta"}</Link>
        </>
      }
    >
      {!supabaseConfigured && <Alert>Configure VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY (veja .env.example).</Alert>}
      <Alert kind="info">{notice}</Alert>
      <Alert>{error}</Alert>
      <form onSubmit={onSubmit} className="stack">
        <label className="field">
          <span>E-mail</span>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required autoFocus />
        </label>
        <label className="field">
          <span>Senha</span>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </label>
        <button className="btn btn-primary btn-block" disabled={busy}>
          {busy ? "Entrando…" : "Entrar"}
        </button>
        <Link className="center small" to="/recuperar">
          Esqueci minha senha
        </Link>
      </form>
    </AuthShell>
  );
}
