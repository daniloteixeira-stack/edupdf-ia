// CORS para a web (Vercel) e para o app desktop (Tauri no Windows usa
// http://tauri.localhost). Defina ALLOWED_ORIGINS nos secrets das funções,
// separado por vírgulas, ex.: https://edupdf.vercel.app,http://localhost:5173
const DEFAULT_ORIGINS = ["http://tauri.localhost", "tauri://localhost", "http://localhost:5173"];

function allowedOrigins(): string[] {
  const extra = (Deno.env.get("ALLOWED_ORIGINS") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean);
  return [...DEFAULT_ORIGINS, ...extra];
}

export function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allow = allowedOrigins().includes(origin) ? origin : allowedOrigins()[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
}

export function json(req: Request, body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), "Content-Type": "application/json" },
  });
}

export class HttpError extends Error {
  constructor(public status: number, public code: string, message: string) {
    super(message);
  }
}

/** Envolve o handler com preflight CORS e tratamento de erro uniforme. */
export function serve(handler: (req: Request) => Promise<Response>) {
  Deno.serve(async (req) => {
    if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders(req) });
    if (req.method !== "POST") return json(req, { error: "METHOD_NOT_ALLOWED" }, 405);
    try {
      return await handler(req);
    } catch (err) {
      if (err instanceof HttpError) {
        return json(req, { error: err.code, message: err.message }, err.status);
      }
      console.error(err);
      return json(req, { error: "INTERNAL", message: "Erro interno. Tente novamente." }, 500);
    }
  });
}
