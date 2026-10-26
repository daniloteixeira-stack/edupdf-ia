// POST /functions/v1/generate-questions
// Corpo: { module_id, multiple_choice, open, difficulty?, page_from?, page_to?, instructions?, slides_per_block? }
// Só professor/admin. Gera questões com IA a partir do PDF do módulo e grava
// questions + question_keys (gabarito separado, invisível ao aluno). Com
// slides_per_block > 0, cada trecho do PDF vira slides de aula seguidos das
// questões sobre eles (edu_lesson_slides, mesma numeração de position).
import { HttpError, json, serve } from "../_shared/cors.ts";
import { adminClient, requireAdmin } from "../_shared/auth.ts";
import { generateLesson, MAX_SOURCE_CHARS, slicePages } from "../_shared/ai.ts";

interface Body {
  module_id?: string;
  multiple_choice?: number;
  open?: number;
  difficulty?: "facil" | "medio" | "dificil";
  page_from?: number | null;
  page_to?: number | null;
  instructions?: string;
  slides_per_block?: number;
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

  const blocks = await generateLesson({
    sourceText: source,
    moduleTitle: mod.title,
    multipleChoice: mc,
    open,
    difficulty,
    instructions: body.instructions?.slice(0, 2000),
    slidesPerBlock: clampInt(body.slides_per_block, 0, 4, 0),
  });
  if (!blocks.some((b) => b.questions.length)) {
    throw new HttpError(502, "AI_EMPTY", "A IA não gerou questões válidas. Tente de novo.");
  }

  // Continua a numeração depois do último slide ou questão do módulo.
  const [{ data: lastQ }, { data: lastS }] = await Promise.all([
    admin.from("edu_questions").select("position").eq("module_id", mod.id).order("position", { ascending: false }).limit(1).maybeSingle(),
    admin.from("edu_lesson_slides").select("position").eq("module_id", mod.id).order("position", { ascending: false }).limit(1).maybeSingle(),
  ]);
  let position = Math.max(lastQ?.position ?? -1, lastS?.position ?? -1) + 1;

  // Ordem final: slides do bloco 1, questões do bloco 1, slides do bloco 2, ...
  const slideRows: Record<string, unknown>[] = [];
  const generated: Array<(typeof blocks)[number]["questions"][number] & { position: number }> = [];
  for (const b of blocks) {
    for (const sl of b.slides) {
      slideRows.push({
        module_id: mod.id,
        position: position++,
        title: sl.title.trim().slice(0, 200),
        bullets: sl.bullets.map((t) => t.trim()).filter(Boolean).slice(0, 8),
        explanation: sl.explanation?.trim() || null,
        highlight: sl.highlight?.trim() || null,
        source_page: sl.source_page,
      });
    }
    for (const q of b.questions) generated.push({ ...q, position: position++ });
  }

  const rows = generated.map((q) => {
    const options = q.type === "multiple_choice"
      ? q.options.map((text) => ({ id: crypto.randomUUID().slice(0, 8), text: text.trim() }))
      : [];
    return {
      question: {
        module_id: mod.id,
        position: q.position,
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

  let slidesCreated = 0;
  if (slideRows.length) {
    const { error: slideErr } = await admin.from("edu_lesson_slides").insert(slideRows);
    if (slideErr) console.error("insert lesson_slides", slideErr.message);
    else slidesCreated = slideRows.length;
  }

  return json(req, { created: inserted.length, slides: slidesCreated });
});
