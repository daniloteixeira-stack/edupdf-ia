// POST /functions/v1/generate-questions
// Corpo: { module_id, multiple_choice, open, difficulty?, page_from?, page_to?, instructions? }
// Só professor/admin. Gera questões com IA a partir do PDF do módulo e grava
// questions + question_keys (gabarito separado, invisível ao aluno).
import { HttpError, json, serve } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/auth.ts";
import { generateQuestions, MAX_SOURCE_CHARS, slicePages } from "../_shared/ai.ts";

interface Body {
  module_id?: string;
  multiple_choice?: number;
  open?: number;
  difficulty?: "facil" | "medio" | "dificil";
  page_from?: number | null;
  page_to?: number | null;
  instructions?: string;
}

const clampInt = (v: unknown, min: number, max: number, dflt: number) => {
  const n = Number.isFinite(Number(v)) ? Math.trunc(Number(v)) : dflt;
  return Math.max(min, Math.min(max, n));
};

serve(async (req) => {
  const admin = adminClient();
  await requireAdmin(req, admin);

  const body = (await req.json().catch(() => ({}))) as Body;
  if (!body.module_id) throw new HttpError(400, "MISSING_MODULE", "Informe o módulo.");
  const mc = clampInt(body.multiple_choice, 0, 30, 5);
  const open = clampInt(body.open, 0, 15, 2);
  if (mc + open === 0) throw new HttpError(400, "NO_QUESTIONS", "Peça pelo menos uma questão.");
  const difficulty = ["facil", "medio", "dificil"].includes(body.difficulty ?? "") ? body.difficulty! : "medio";

  const { data: mod } = await admin
    .from("edu_modules")
    .select("id, title, pdf_file_id, pdf_files:edu_pdf_files(extracted_text, status)")
    .eq("id", body.module_id)
    .single();
  if (!mod) throw new HttpError(404, "MODULE_NOT_FOUND", "Módulo não encontrado.");

  // deno-lint-ignore no-explicit-any
  const pdf = (mod as any).pdf_files as { extracted_text: string | null; status: string } | null;
  if (!pdf || pdf.status !== "ready" || !pdf.extracted_text?.trim()) {
    throw new HttpError(400, "PDF_NOT_READY", "Vincule ao módulo um PDF com texto extraído.");
  }

  const source = slicePages(pdf.extracted_text, body.page_from, body.page_to);
  if (!source.trim()) throw new HttpError(400, "EMPTY_RANGE", "Nenhum texto nesse intervalo de páginas.");
  if (source.length > MAX_SOURCE_CHARS) {
    throw new HttpError(
      413,
      "SOURCE_TOO_LARGE",
      `O trecho escolhido tem ${source.length.toLocaleString("pt-BR")} caracteres (limite ${MAX_SOURCE_CHARS.toLocaleString("pt-BR")}). ` +
        "Escolha um intervalo de páginas menor.",
    );
  }

  const generated = await generateQuestions({
    sourceText: source,
    moduleTitle: mod.title,
    multipleChoice: mc,
    open,
    difficulty,
    instructions: body.instructions?.slice(0, 2000),
  });
  if (!generated.length) throw new HttpError(502, "AI_EMPTY", "A IA não gerou questões válidas. Tente de novo.");

  const { data: last } = await admin
    .from("edu_questions")
    .select("position")
    .eq("module_id", mod.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  let position = (last?.position ?? -1) + 1;

  const rows = generated.map((q) => {
    const options = q.type === "multiple_choice"
      ? q.options.map((text) => ({ id: crypto.randomUUID().slice(0, 8), text: text.trim() }))
      : [];
    return {
      question: {
        module_id: mod.id,
        position: position++,
        type: q.type,
        prompt: q.prompt.trim(),
        options,
        source_page: q.source_page,
      },
      key: {
        correct_option_id: q.type === "multiple_choice" ? options[q.correct_index!].id : null,
        explanation: q.explanation,
        expected_answer: q.expected_answer,
        key_points: q.key_points,
        source_excerpt: q.source_excerpt,
      },
    };
  });

  const { data: inserted, error } = await admin
    .from("edu_questions")
    .insert(rows.map((r) => r.question))
    .select("id, position");
  if (error || !inserted) throw new Error(`insert questions: ${error?.message}`);

  const byPosition = new Map(inserted.map((q) => [q.position, q.id]));
  const keys = rows.map((r) => ({ question_id: byPosition.get(r.question.position)!, ...r.key }));
  const { error: keyErr } = await admin.from("edu_question_keys").insert(keys);
  if (keyErr) {
    await admin.from("edu_questions").delete().in("id", inserted.map((q) => q.id));
    throw new Error(`insert question_keys: ${keyErr.message}`);
  }

  return json(req, { created: inserted.length });
});
