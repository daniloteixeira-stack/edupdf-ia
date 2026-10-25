import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import { PLATFORM } from "../lib/platform";
import { useAuth } from "../auth/AuthProvider";
import { Alert, AuthShell } from "../components/AuthShell";
import { PasswordFields, passwordIsValid } from "../components/PasswordFields";

/** Obrigatória quando o admin define uma senha temporária. */
export function ChangePasswordPage() {
  const navigate = useNavigate();
  const { refreshProfile, signOut } = useAuth();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!passwordIsValid(password, confirm)) return;
    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;
      const { error: logErr } = await supabase.rpc("edu_log_access", {
        p_event: "password_changed",
        p_platform: PLATFORM,
        p_user_agent: navigator.userAgent,
      });
      if (logErr) throw logErr;
      await refreshProfile();
      navigate("/", { replace: true });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell
      title="Defina uma nova senha"
      subtitle="Sua senha foi redefinida pelo professor. Crie uma senha pessoal para continuar."
      footer={
        <button className="btn-link" onClick={() => void signOut()}>
          Sair
        </button>
      }
    >
      <Alert>{error}</Alert>
      <form onSubmit={save} className="stack">
        <PasswordFields password={password} confirm={confirm} onPassword={setPassword} onConfirm={setConfirm} />
        <button className="btn btn-primary btn-block" disabled={busy || !passwordIsValid(password, confirm)}>
          Salvar e continuar
        </button>
      </form>
    </AuthShell>
  );
}
