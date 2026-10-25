import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import { adminUsers, type AdminAction } from "../lib/api";
import { useAuth } from "../auth/AuthProvider";
import { EVENT_LABEL, fmtDate, STATUS_LABEL, timeAgo } from "../lib/format";
import { Modal } from "../components/Modal";
import { passwordProblems } from "../components/PasswordFields";
import type { AccessLog, AccountStatus, Profile } from "../lib/types";

type Filter = "all" | AccountStatus | "admin";
type Dialog =
  | { kind: "status"; user: Profile; action: "pause" | "block" | "reactivate" }
  | { kind: "password"; user: Profile }
  | { kind: "role"; user: Profile }
  | { kind: "create" }
  | null;

/**
 * Painel de gestão de usuários (estilo "Estoque App"):
 * tabela em tempo real, filtros, histórico de acessos e ações rápidas
 * (pausar, cancelar acesso, reativar, redefinir senha, promover a admin).
 */
export function UserManagement() {
  const { profile: me } = useAuth();
  const [users, setUsers] = useState<Profile[]>([]);
  const [logs, setLogs] = useState<AccessLog[]>([]);
  const [filter, setFilter] = useState<Filter>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Profile | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [toast, setToast] = useState<{ kind: "success" | "error"; text: string } | null>(null);
  const [live, setLive] = useState(false);
  const [menuFor, setMenuFor] = useState<string | null>(null);

  useEffect(() => {
    if (!menuFor) return;
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("click", close);
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
    };
  }, [menuFor]);

  const load = useCallback(async () => {
    const [{ data: u, error: uErr }, { data: l, error: lErr }] = await Promise.all([
      supabase.from("edu_profiles").select("*").order("created_at", { ascending: false }),
      supabase.from("edu_access_logs").select("*").order("created_at", { ascending: false }).limit(500),
    ]);
    if (uErr || lErr) setToast({ kind: "error", text: friendlyError(uErr ?? lErr) });
    setUsers((u ?? []) as Profile[]);
    setLogs((l ?? []) as AccessLog[]);
  }, []);

  useEffect(() => {
    void load();
    const channel = supabase
      .channel("admin-users-live")
      .on("postgres_changes", { event: "*", schema: "public", table: "edu_profiles" }, (payload) => {
        setUsers((prev) => {
          if (payload.eventType === "DELETE") return prev.filter((p) => p.id !== (payload.old as Profile).id);
          const row = payload.new as Profile;
          const exists = prev.some((p) => p.id === row.id);
          return exists ? prev.map((p) => (p.id === row.id ? row : p)) : [row, ...prev];
        });
        setSelected((s) => (s && payload.eventType !== "DELETE" && s.id === (payload.new as Profile).id ? (payload.new as Profile) : s));
      })
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "edu_access_logs" }, (payload) => {
        setLogs((prev) => [payload.new as AccessLog, ...prev].slice(0, 500));
      })
      .subscribe((status) => setLive(status === "SUBSCRIBED"));
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [load]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  const counts = useMemo(() => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return {
      total: users.length,
      active: users.filter((u) => u.status === "active").length,
      paused: users.filter((u) => u.status === "paused").length,
      blocked: users.filter((u) => u.status === "blocked").length,
      today: users.filter((u) => u.last_sign_in_at && new Date(u.last_sign_in_at) >= today).length,
    };
  }, [users]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (filter === "admin" ? u.role !== "admin" : filter !== "all" && u.status !== filter) return false;
      return !q || u.email.toLowerCase().includes(q) || (u.full_name ?? "").toLowerCase().includes(q);
    });
  }, [users, filter, search]);

  const run = async (payload: AdminAction, success: string) => {
    try {
      await adminUsers(payload);
      setToast({ kind: "success", text: success });
      setDialog(null);
      if (payload.action === "create_user" || payload.action === "set_password") void load();
    } catch (err) {
      setToast({ kind: "error", text: friendlyError(err) });
    }
  };

  const selectedLogs = selected ? logs.filter((l) => l.user_id === selected.id).slice(0, 50) : [];

  return (
    <div className="page">
      <header className="page-head row between wrap">
        <div>
          <h1>Usuários</h1>
          <p className="muted">
            <span className={`live-dot ${live ? "on" : ""}`} /> {live ? "Atualizando em tempo real" : "Conectando…"}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setDialog({ kind: "create" })}>
          + Novo aluno
        </button>
      </header>

      <div className="kpis">
        <Kpi label="Total" value={counts.total} onClick={() => setFilter("all")} active={filter === "all"} />
        <Kpi label="Ativos" value={counts.active} tone="good" onClick={() => setFilter("active")} active={filter === "active"} />
        <Kpi label="Pausados" value={counts.paused} tone="mid" onClick={() => setFilter("paused")} active={filter === "paused"} />
        <Kpi label="Bloqueados" value={counts.blocked} tone="bad" onClick={() => setFilter("blocked")} active={filter === "blocked"} />
        <Kpi label="Acessaram hoje" value={counts.today} />
      </div>

      <div className="toolbar">
        <input className="search" placeholder="Buscar por nome ou e-mail…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)}>
          <option value="all">Todos</option>
          <option value="active">Ativos</option>
          <option value="paused">Pausados</option>
          <option value="blocked">Bloqueados</option>
          <option value="admin">Administradores</option>
        </select>
      </div>

      <div className="split">
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Usuário</th>
                <th>Status</th>
                <th>Papel</th>
                <th>Último acesso</th>
                <th>Cadastro</th>
                <th className="right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((u) => (
                <tr key={u.id} className={selected?.id === u.id ? "selected" : ""} onClick={() => setSelected(u)}>
                  <td>
                    <div className="user-cell">
                      <span className="avatar">{(u.full_name || u.email).slice(0, 1).toUpperCase()}</span>
                      <div>
                        <strong>{u.full_name || "—"}</strong>
                        <div className="muted small">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <span className={`status status-${u.status}`}>{STATUS_LABEL[u.status]}</span>
                  </td>
                  <td>{u.role === "admin" ? "Professor/Admin" : "Aluno"}</td>
                  <td title={fmtDate(u.last_sign_in_at)}>
                    {timeAgo(u.last_sign_in_at)}
                    {u.last_sign_in_platform && <span className="muted small"> · {u.last_sign_in_platform === "desktop" ? "Windows" : "Web"}</span>}
                  </td>
                  <td>{fmtDate(u.created_at)}</td>
                  <td className="right nowrap" onClick={(e) => e.stopPropagation()}>
                    <ActionsMenu
                      open={menuFor === u.id}
                      onToggle={() => setMenuFor(menuFor === u.id ? null : u.id)}
                      items={[
                        ...(u.id === me?.id
                          ? []
                          : u.status === "active"
                            ? [{ label: "Pausar acesso", run: () => setDialog({ kind: "status", user: u, action: "pause" }) }]
                            : [{ label: "Reativar acesso", run: () => setDialog({ kind: "status", user: u, action: "reactivate" }) }]),
                        ...(u.id !== me?.id && u.status !== "blocked"
                          ? [{ label: "Cancelar acesso", danger: true, run: () => setDialog({ kind: "status", user: u, action: "block" }) }]
                          : []),
                        { label: "Redefinir senha", run: () => setDialog({ kind: "password", user: u }) },
                        ...(u.id !== me?.id
                          ? [{ label: u.role === "admin" ? "Tornar aluno" : "Tornar professor/admin", run: () => setDialog({ kind: "role", user: u }) }]
                          : []),
                      ]}
                    />
                  </td>
                </tr>
              ))}
              {!visible.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhum usuário encontrado.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <aside className="side-panel">
          {selected ? (
            <>
              <h3>{selected.full_name || selected.email}</h3>
              <p className="muted small">{selected.email}</p>
              <dl className="facts">
                <dt>Status</dt>
                <dd>
                  <span className={`status status-${selected.status}`}>{STATUS_LABEL[selected.status]}</span>
                  {selected.status_reason && <div className="muted small">Motivo: {selected.status_reason}</div>}
                </dd>
                <dt>Cadastro via</dt>
                <dd>{selected.signup_platform === "desktop" ? "App Windows" : "Painel admin"}</dd>
                <dt>Troca de senha pendente</dt>
                <dd>{selected.must_change_password ? "Sim" : "Não"}</dd>
              </dl>
              <h4>Histórico de acessos</h4>
              <ul className="log-list">
                {selectedLogs.map((l) => (
                  <li key={l.id} className={l.event === "blocked_attempt" ? "bad" : ""}>
                    <span>{EVENT_LABEL[l.event]}</span>
                    <span className="muted small">
                      {fmtDate(l.created_at)} · {l.platform === "desktop" ? "Windows" : "Web"}
                    </span>
                  </li>
                ))}
                {!selectedLogs.length && <li className="muted">Sem registros.</li>}
              </ul>
            </>
          ) : (
            <>
              <h3>Acessos recentes</h3>
              <ul className="log-list">
                {logs.slice(0, 25).map((l) => {
                  const u = users.find((x) => x.id === l.user_id);
                  return (
                    <li key={l.id} className={l.event === "blocked_attempt" ? "bad" : ""}>
                      <span>
                        <strong>{u?.full_name || u?.email || "—"}</strong> · {EVENT_LABEL[l.event]}
                      </span>
                      <span className="muted small">{timeAgo(l.created_at)}</span>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </aside>
      </div>

      {dialog?.kind === "status" && <StatusDialog dialog={dialog} onClose={() => setDialog(null)} onRun={run} />}
      {dialog?.kind === "password" && <PasswordDialog user={dialog.user} onClose={() => setDialog(null)} onRun={run} />}
      {dialog?.kind === "role" && <RoleDialog user={dialog.user} onClose={() => setDialog(null)} onRun={run} />}
      {dialog?.kind === "create" && <CreateDialog onClose={() => setDialog(null)} onRun={run} />}
      {toast && <div className={`toast toast-${toast.kind}`}>{toast.text}</div>}
    </div>
  );
}

function Kpi({ label, value, tone, onClick, active }: { label: string; value: number; tone?: string; onClick?: () => void; active?: boolean }) {
  return (
    <button className={`kpi ${tone ? `kpi-${tone}` : ""} ${active ? "active" : ""}`} onClick={onClick} disabled={!onClick}>
      <span>{label}</span>
      <strong>{value}</strong>
    </button>
  );
}

function ActionsMenu({ open, onToggle, items }: { open: boolean; onToggle: () => void; items: Array<{ label: string; run: () => void; danger?: boolean }> }) {
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  return (
    <div className="menu">
      <button
        className="btn btn-sm btn-ghost"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={(e) => {
          e.stopPropagation();
          const r = e.currentTarget.getBoundingClientRect();
          // posição fixa: o menu não é cortado pela rolagem da tabela
          setPos({ top: Math.min(r.bottom + 4, window.innerHeight - 200), right: window.innerWidth - r.right });
          onToggle();
        }}
      >
        Ações ▾
      </button>
      {open && pos && (
        <ul className="menu-list" role="menu" style={{ position: "fixed", top: pos.top, right: pos.right }}>
          {items.map((it) => (
            <li key={it.label}>
              <button
                role="menuitem"
                className={it.danger ? "danger" : ""}
                onClick={() => {
                  onToggle();
                  it.run();
                }}
              >
                {it.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type Run = (payload: AdminAction, success: string) => Promise<void>;

function StatusDialog({ dialog, onClose, onRun }: { dialog: { user: Profile; action: "pause" | "block" | "reactivate" }; onClose: () => void; onRun: Run }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const { user, action } = dialog;
  const copy = {
    pause: { title: "Pausar acesso", text: "O usuário sai do app imediatamente e não consegue entrar até ser reativado.", btn: "Pausar", ok: "Acesso pausado." },
    block: { title: "Cancelar acesso", text: "Revoga as sessões e bloqueia a conta. Use para desligamentos ou fraude.", btn: "Cancelar acesso", ok: "Acesso cancelado." },
    reactivate: { title: "Reativar acesso", text: "O usuário volta a entrar normalmente.", btn: "Reativar", ok: "Acesso reativado." },
  }[action];
  const submit = async () => {
    setBusy(true);
    await onRun(action === "reactivate" ? { action, user_id: user.id } : { action, user_id: user.id, reason: reason || undefined }, copy.ok);
    setBusy(false);
  };
  return (
    <Modal
      title={copy.title}
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Voltar
          </button>
          <button className={`btn ${action === "block" ? "btn-danger" : "btn-primary"}`} disabled={busy} onClick={() => void submit()}>
            {busy ? "Aplicando…" : copy.btn}
          </button>
        </>
      }
    >
      <p>
        <strong>{user.full_name || user.email}</strong> — {copy.text}
      </p>
      {action !== "reactivate" && (
        <label className="field">
          <span>Motivo (opcional, fica no histórico)</span>
          <input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} />
        </label>
      )}
    </Modal>
  );
}

function PasswordDialog({ user, onClose, onRun }: { user: Profile; onClose: () => void; onRun: Run }) {
  const [mode, setMode] = useState<"email" | "temp">("email");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const invalid = mode === "temp" && passwordProblems(password).length > 0;
  const generate = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
    const buf = crypto.getRandomValues(new Uint32Array(10));
    setPassword(Array.from(buf, (n) => chars[n % chars.length]).join("") + "7");
  };
  const submit = async () => {
    setBusy(true);
    await onRun(
      mode === "email" ? { action: "send_reset", user_id: user.id } : { action: "set_password", user_id: user.id, password },
      mode === "email" ? "Código de redefinição enviado por e-mail." : "Senha temporária definida. Informe ao aluno.",
    );
    setBusy(false);
  };
  return (
    <Modal
      title="Redefinir senha"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Voltar
          </button>
          <button className="btn btn-primary" disabled={busy || invalid} onClick={() => void submit()}>
            {busy ? "Aplicando…" : "Confirmar"}
          </button>
        </>
      }
    >
      <p>
        <strong>{user.full_name || user.email}</strong>
      </p>
      <label className="radio">
        <input type="radio" checked={mode === "email"} onChange={() => setMode("email")} /> Enviar código de redefinição para {user.email}
      </label>
      <label className="radio">
        <input type="radio" checked={mode === "temp"} onChange={() => setMode("temp")} /> Definir senha temporária (troca obrigatória no próximo login)
      </label>
      {mode === "temp" && (
        <div className="row gap">
          <input className="grow mono" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha temporária" />
          <button className="btn btn-ghost" type="button" onClick={generate}>
            Gerar
          </button>
        </div>
      )}
      {mode === "temp" && <p className="muted small">As sessões abertas do usuário serão encerradas.</p>}
    </Modal>
  );
}

function RoleDialog({ user, onClose, onRun }: { user: Profile; onClose: () => void; onRun: Run }) {
  const next = user.role === "admin" ? "student" : "admin";
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      title="Alterar papel"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Voltar
          </button>
          <button
            className="btn btn-primary"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              await onRun({ action: "set_role", user_id: user.id, role: next }, "Papel atualizado.");
              setBusy(false);
            }}
          >
            {next === "admin" ? "Tornar professor/admin" : "Tornar aluno"}
          </button>
        </>
      }
    >
      <p>
        {next === "admin"
          ? `${user.full_name || user.email} terá controle total: PDFs, módulos e usuários.`
          : `${user.full_name || user.email} perde o acesso administrativo.`}
      </p>
    </Modal>
  );
}

function CreateDialog({ onClose, onRun }: { onClose: () => void; onRun: Run }) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const invalid = !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || passwordProblems(password).length > 0;
  return (
    <Modal
      title="Novo aluno"
      onClose={onClose}
      footer={
        <>
          <button className="btn btn-ghost" onClick={onClose}>
            Voltar
          </button>
          <button
            className="btn btn-primary"
            disabled={busy || invalid}
            onClick={async () => {
              setBusy(true);
              await onRun({ action: "create_user", email, full_name: name, password }, "Aluno criado. Ele troca a senha no 1º acesso.");
              setBusy(false);
            }}
          >
            Criar
          </button>
        </>
      }
    >
      <p className="muted small">O caminho normal é o aluno se cadastrar pelo app Windows. Use isto para casos excepcionais.</p>
      <label className="field">
        <span>Nome</span>
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <label className="field">
        <span>E-mail</span>
        <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </label>
      <label className="field">
        <span>Senha temporária</span>
        <input className="mono" value={password} onChange={(e) => setPassword(e.target.value)} />
      </label>
    </Modal>
  );
}
