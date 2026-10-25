// POST /functions/v1/admin-users
// Ações administrativas em tempo real via Supabase Admin API (service role).
// Corpo: { action, user_id?, ... }
//   pause        { user_id, reason? }      → status "paused", sessões derrubadas
//   reactivate   { user_id }               → status "active"
//   block        { user_id, reason? }      → status "blocked" (cancelar acesso)
//   set_password { user_id, password }     → senha temporária, troca obrigatória no próximo login
//   send_reset   { user_id }               → e-mail com código de redefinição
//   set_role     { user_id, role }         → "admin" | "student"
//   create_user  { email, full_name?, password } → cria aluno já confirmado
import type { SupabaseClient } from "npm:@supabase/supabase-js@2.118.0";
import { HttpError, json, serve } from "../_shared/cors.ts";
import { adminClient, type Caller, requireAdmin } from "../_shared/auth.ts";

const BAN_FOREVER = "876000h"; // ~100 anos
type Action = "pause" | "reactivate" | "block" | "set_password" | "send_reset" | "set_role" | "create_user";

// deno-lint-ignore no-explicit-any
type Body = { action?: Action; user_id?: string; reason?: string; password?: string; role?: string; email?: string; full_name?: string } & Record<string, any>;

function validatePassword(pw: string | undefined): string {
  if (!pw || pw.length < 8 || !/[A-Za-z]/.test(pw) || !/\d/.test(pw)) {
    throw new HttpError(400, "WEAK_PASSWORD", "A senha precisa de 8+ caracteres, com letras e números.");
  }
  return pw;
}

async function loadTarget(admin: SupabaseClient, userId: string | undefined) {
  if (!userId) throw new HttpError(400, "MISSING_USER", "Usuário não informado.");
  const { data } = await admin.from("edu_profiles").select("id, email, role, status").eq("id", userId).single();
  if (!data) throw new HttpError(404, "USER_NOT_FOUND", "Usuário não encontrado.");
  return data as { id: string; email: string; role: string; status: string };
}

async function assertNotLastAdmin(admin: SupabaseClient, targetId: string) {
  const { count } = await admin
    .from("edu_profiles")
    .select("id", { count: "exact", head: true })
    .eq("role", "admin")
    .eq("status", "active")
    .neq("id", targetId);
  if (!count) throw new HttpError(409, "LAST_ADMIN", "Não é possível remover o último administrador ativo.");
}

async function setStatus(admin: SupabaseClient, caller: Caller, userId: string, status: string, reason?: string) {
  const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
    ban_duration: status === "active" ? "none" : BAN_FOREVER,
  });
  if (banErr) throw new Error(`ban: ${banErr.message}`);

  const { error } = await admin
    .from("edu_profiles")
    .update({
      status,
      status_reason: reason?.slice(0, 500) ?? null,
      status_changed_at: new Date().toISOString(),
      status_changed_by: caller.id,
    })
    .eq("id", userId);
  if (error) throw new Error(`profile status: ${error.message}`);

  if (status !== "active") await revokeSessions(admin, userId);
}

async function revokeSessions(admin: SupabaseClient, userId: string) {
  const { error } = await admin.rpc("edu_admin_revoke_sessions", { p_user_id: userId });
  if (error) throw new Error(`revoke sessions: ${error.message}`);
}

async function audit(admin: SupabaseClient, caller: Caller, target: string | null, action: string, details = {}) {
  await admin.from("edu_admin_audit").insert({ admin_id: caller.id, target_user_id: target, action, details });
}

serve(async (req) => {
  const admin = adminClient();
  const caller = await requireAdmin(req, admin);
  const body = (await req.json().catch(() => ({}))) as Body;

  switch (body.action) {
    case "pause":
    case "block": {
      const target = await loadTarget(admin, body.user_id);
      if (target.id === caller.id) throw new HttpError(409, "SELF_ACTION", "Você não pode bloquear a si mesmo.");
      if (target.role === "admin") await assertNotLastAdmin(admin, target.id);
      const status = body.action === "pause" ? "paused" : "blocked";
      await setStatus(admin, caller, target.id, status, body.reason);
      await audit(admin, caller, target.id, body.action, { reason: body.reason ?? null });
      return json(req, { ok: true, status });
    }

    case "reactivate": {
      const target = await loadTarget(admin, body.user_id);
      await setStatus(admin, caller, target.id, "active");
      await audit(admin, caller, target.id, "reactivate");
      return json(req, { ok: true, status: "active" });
    }

    case "set_password": {
      const target = await loadTarget(admin, body.user_id);
      const password = validatePassword(body.password);
      const { error } = await admin.auth.admin.updateUserById(target.id, { password });
      if (error) throw new HttpError(400, "PASSWORD_REJECTED", error.message);
      await admin.from("edu_profiles").update({ must_change_password: true }).eq("id", target.id);
      await revokeSessions(admin, target.id);
      await audit(admin, caller, target.id, "set_password");
      return json(req, { ok: true });
    }

    case "send_reset": {
      const target = await loadTarget(admin, body.user_id);
      const { error } = await admin.auth.resetPasswordForEmail(target.email);
      if (error) throw new HttpError(400, "RESET_FAILED", error.message);
      await audit(admin, caller, target.id, "send_reset");
      return json(req, { ok: true });
    }

    case "set_role": {
      const target = await loadTarget(admin, body.user_id);
      if (body.role !== "admin" && body.role !== "student") {
        throw new HttpError(400, "INVALID_ROLE", "Papel inválido.");
      }
      if (target.role === "admin" && body.role === "student") {
        if (target.id === caller.id) throw new HttpError(409, "SELF_ACTION", "Você não pode remover seu próprio acesso de admin.");
        await assertNotLastAdmin(admin, target.id);
      }
      const { error } = await admin.from("edu_profiles").update({ role: body.role }).eq("id", target.id);
      if (error) throw new Error(`set role: ${error.message}`);
      await audit(admin, caller, target.id, "set_role", { role: body.role });
      return json(req, { ok: true });
    }

    case "create_user": {
      const email = (body.email ?? "").trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new HttpError(400, "INVALID_EMAIL", "E-mail inválido.");
      const password = validatePassword(body.password);
      const { data, error } = await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { app: "edupdf", platform: "admin_panel", full_name: body.full_name?.trim() || null },
      });
      if (error || !data.user) throw new HttpError(400, "CREATE_FAILED", error?.message ?? "Falha ao criar usuário.");
      await admin.from("edu_profiles").update({ must_change_password: true }).eq("id", data.user.id);
      await audit(admin, caller, data.user.id, "create_user");
      return json(req, { ok: true, user_id: data.user.id });
    }

    default:
      throw new HttpError(400, "INVALID_ACTION", "Ação desconhecida.");
  }
});
