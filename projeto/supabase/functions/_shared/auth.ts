import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { HttpError } from "./cors.ts";

export interface Caller {
  id: string;
  email: string;
  role: "admin" | "student";
  status: "active" | "paused" | "blocked";
}

/** Cliente com service role: ignora RLS. Use só depois de checar permissões. */
export function adminClient(): SupabaseClient {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY ausentes");
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

/** Valida o JWT do chamador e carrega o perfil. Recusa contas pausadas/bloqueadas. */
export async function requireCaller(req: Request, admin: SupabaseClient): Promise<Caller> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  if (!token) throw new HttpError(401, "NOT_AUTHENTICATED", "Faça login novamente.");

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "NOT_AUTHENTICATED", "Sessão expirada. Faça login novamente.");

  const { data: profile, error: pErr } = await admin
    .from("edu_profiles")
    .select("id, email, role, status")
    .eq("id", data.user.id)
    .single();
  if (pErr || !profile) throw new HttpError(403, "PROFILE_NOT_FOUND", "Perfil não encontrado.");
  if (profile.status !== "active") {
    throw new HttpError(403, "ACCOUNT_INACTIVE", "Seu acesso está pausado ou cancelado. Fale com o professor.");
  }
  return profile as Caller;
}

export async function requireAdmin(req: Request, admin: SupabaseClient): Promise<Caller> {
  const caller = await requireCaller(req, admin);
  if (caller.role !== "admin") throw new HttpError(403, "FORBIDDEN", "Apenas professores/administradores.");
  return caller;
}

/** Mesma regra de public.can_access_module(), avaliada com service role. */
export async function assertModuleAccess(admin: SupabaseClient, caller: Caller, moduleId: string) {
  const { data: mod } = await admin
    .from("edu_modules")
    .select("id, is_published, audience, max_attempts, pdf_file_id")
    .eq("id", moduleId)
    .single();
  if (!mod) throw new HttpError(404, "MODULE_NOT_FOUND", "Módulo não encontrado.");
  if (caller.role === "admin") return mod;
  if (!mod.is_published) throw new HttpError(403, "MODULE_FORBIDDEN", "Módulo não liberado.");
  if (mod.audience === "selected") {
    const { count } = await admin
      .from("edu_module_students")
      .select("student_id", { count: "exact", head: true })
      .eq("module_id", moduleId)
      .eq("student_id", caller.id);
    if (!count) throw new HttpError(403, "MODULE_FORBIDDEN", "Módulo não liberado para você.");
  }
  return mod;
}
