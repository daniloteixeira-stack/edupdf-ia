import { createClient } from "@supabase/supabase-js";

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const supabaseConfigured = Boolean(url && anonKey);

export const supabase = createClient(url ?? "http://localhost:54321", anonKey ?? "missing-key", {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false, // fluxo por código OTP, sem links mágicos
    storageKey: "edupdf-auth",
  },
});

/** Traduz erros do Supabase/Edge Functions para mensagens em português. */
export function friendlyError(err: unknown): string {
  const raw =
    typeof err === "string"
      ? err
      : err && typeof err === "object" && "message" in err
        ? String((err as { message: unknown }).message)
        : "Erro inesperado.";
  const map: Array<[RegExp, string]> = [
    [/SIGNUP_DESKTOP_ONLY|Database error saving new user/i, "O cadastro só pode ser feito pelo aplicativo Windows."],
    [/Invalid login credentials/i, "E-mail ou senha incorretos."],
    [/Token has expired or is invalid|otp.*(expired|invalid)/i, "Código inválido ou expirado. Peça um novo."],
    [/User is banned|ACCOUNT_INACTIVE/i, "Seu acesso está pausado ou cancelado. Fale com o professor."],
    [/rate limit|security purposes|only request this after/i, "Muitas tentativas. Aguarde um minuto e tente de novo."],
    [/Email not confirmed/i, "Confirme seu e-mail com o código enviado."],
    [/Password should be|weak.?password/i, "Senha fraca: use 8+ caracteres com letras e números."],
    [/MAX_ATTEMPTS_REACHED/i, "Você já usou todas as tentativas desta questão."],
    [/MODULE_FORBIDDEN/i, "Este módulo não está liberado para você."],
    [/PROFILE_NOT_FOUND/i, "Esta conta não tem acesso ao EduPDF IA."],
    [/Failed to fetch|NetworkError/i, "Sem conexão com o servidor. Verifique a internet."],
  ];
  for (const [re, msg] of map) if (re.test(raw)) return msg;
  return raw;
}
