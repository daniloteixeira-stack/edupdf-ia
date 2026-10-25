const dtf = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" });
export const fmtDate = (iso: string | null | undefined) => (iso ? dtf.format(new Date(iso)) : "—");

export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "nunca";
  const s = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return "agora";
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  if (s < 86400 * 30) return `há ${Math.floor(s / 86400)} d`;
  return fmtDate(iso);
}

export const fmtBytes = (n: number) =>
  n < 1024 * 1024 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export const STATUS_LABEL = { active: "Ativo", paused: "Pausado", blocked: "Bloqueado" } as const;
export const EVENT_LABEL = {
  sign_in: "Entrou",
  sign_out: "Saiu",
  signup: "Cadastro",
  password_changed: "Trocou a senha",
  blocked_attempt: "Tentativa bloqueada",
} as const;
