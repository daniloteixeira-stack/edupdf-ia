import type { ReactNode } from "react";

export function AuthShell({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="brand">
          <span className="brand-mark">E</span> EduPDF <strong>IA</strong>
        </div>
        <h1>{title}</h1>
        {subtitle && <p className="muted">{subtitle}</p>}
        {children}
        {footer && <div className="auth-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function Alert({ kind = "error", children }: { kind?: "error" | "info" | "success"; children: ReactNode }) {
  if (!children) return null;
  return (
    <div className={`alert alert-${kind}`} role={kind === "error" ? "alert" : "status"}>
      {children}
    </div>
  );
}

export function Steps({ current, labels }: { current: number; labels: string[] }) {
  return (
    <ol className="steps">
      {labels.map((label, i) => (
        <li key={label} className={i < current ? "done" : i === current ? "current" : ""}>
          <span>{i < current ? "✓" : i + 1}</span> {label}
        </li>
      ))}
    </ol>
  );
}
