// POST /functions/v1/edu-pdf-storage
// Acesso ao bucket privado "edu-pdfs" só para professor/admin, por URL assinada.
// Corpo:
//   { action: "sign_upload" }            → { path, token } para uploadToSignedUrl
//   { action: "sign_download", path }    → { url } válida por 5 minutos
//   { action: "remove", path }           → apaga o arquivo
import { HttpError, json, serve } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/auth.ts";

const BUCKET = "edu-pdfs";
const PATH_RE = /^\d{4}\/[0-9a-f-]{36}\.pdf$/;

serve(async (req) => {
  const admin = adminClient();
  await requireAdmin(req, admin);
  const body = (await req.json().catch(() => ({}))) as { action?: string; path?: string };
  const storage = admin.storage.from(BUCKET);

  switch (body.action) {
    case "sign_upload": {
      const path = `${new Date().getFullYear()}/${crypto.randomUUID()}.pdf`;
      const { data, error } = await storage.createSignedUploadUrl(path);
      if (error) throw new Error(`sign upload: ${error.message}`);
      return json(req, { path: data.path, token: data.token });
    }
    case "sign_download": {
      if (!body.path || !PATH_RE.test(body.path)) throw new HttpError(400, "INVALID_PATH", "Arquivo inválido.");
      const { data, error } = await storage.createSignedUrl(body.path, 300);
      if (error) throw new HttpError(404, "NOT_FOUND", "Arquivo não encontrado.");
      return json(req, { url: data.signedUrl });
    }
    case "remove": {
      if (!body.path || !PATH_RE.test(body.path)) throw new HttpError(400, "INVALID_PATH", "Arquivo inválido.");
      const { error } = await storage.remove([body.path]);
      if (error) throw new Error(`remove: ${error.message}`);
      return json(req, { ok: true });
    }
    default:
      throw new HttpError(400, "INVALID_ACTION", "Ação desconhecida.");
  }
});
