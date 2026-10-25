import { useState } from "react";

export function passwordProblems(pw: string): string[] {
  const issues: string[] = [];
  if (pw.length < 8) issues.push("8 ou mais caracteres");
  if (!/[A-Za-z]/.test(pw)) issues.push("uma letra");
  if (!/\d/.test(pw)) issues.push("um número");
  return issues;
}

interface Props {
  password: string;
  confirm: string;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
}

/** Campos "senha" + "confirmar senha" com checklist de requisitos. */
export function PasswordFields({ password, confirm, onPassword, onConfirm }: Props) {
  const [show, setShow] = useState(false);
  const problems = passwordProblems(password);
  const mismatch = confirm.length > 0 && confirm !== password;
  return (
    <>
      <label className="field">
        <span>Nova senha</span>
        <input
          type={show ? "text" : "password"}
          value={password}
          autoComplete="new-password"
          onChange={(e) => onPassword(e.target.value)}
          required
        />
      </label>
      <label className="field">
        <span>Confirmar senha</span>
        <input
          type={show ? "text" : "password"}
          value={confirm}
          autoComplete="new-password"
          onChange={(e) => onConfirm(e.target.value)}
          aria-invalid={mismatch}
          required
        />
      </label>
      <label className="check">
        <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> Mostrar senha
      </label>
      <ul className="pw-rules">
        {["8 ou mais caracteres", "uma letra", "um número"].map((rule) => (
          <li key={rule} className={problems.includes(rule) ? "" : "ok"}>
            {problems.includes(rule) ? "○" : "✓"} {rule}
          </li>
        ))}
        {mismatch && <li className="bad">As senhas não conferem</li>}
      </ul>
    </>
  );
}

export const passwordIsValid = (pw: string, confirm: string) => passwordProblems(pw).length === 0 && pw === confirm;
