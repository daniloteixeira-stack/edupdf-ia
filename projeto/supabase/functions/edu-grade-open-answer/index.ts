// POST /functions/v1/grade-open-answer
// Corpo: { question_id, answer_text }
// Corrige a resposta dissertativa com IA contra o PDF do módulo e grava a
// tentativa em student_answers. Devolve porcentagem (0–100) e feedback.
import { HttpError, json, serve } from "../_shared/cors.ts";
import { adminClient, assertModuleAccess, requireCaller } from "../_shared/auth.ts";
import { AI_MODEL, gradeOpenAnswer, relevantExcerpts } from "../_shared/ai.ts";

// Até este tamanho o PDF inteiro vai como referência (e fica em cache);
// acima disso, só os trechos mais relacionados à questão.
const FULL_REFERENCE_CHARS = Number(Deno.env.get("AI_FULL_REFERENCE_CHARS") ?? 250_000);
const EXCERPT_BUDGET_CHARS = 60_000;
const PASS_THRESHOLD = 60;

serve(async (req) => {
  const admin = adminClient();
  const caller = await requireCaller(req, admin);

  const body = (await req.json().catch(() => ({}))) as { question_id?: string; answer_text?: string };
  const answer = (body.answer_text ?? "").trim();
  if (!body.question_id) throw new HttpError(400, "MISSING_QUESTION", "Questão não informada.");
  if (answer.length < 10) throw new HttpError(400, "ANSWER_TOO_SHORT", "Escreva uma resposta mais completa.");
  if (answer.length > 8000) throw new HttpError(400, "ANSWER_TOO_LONG", "A resposta passou de 8.000 caracteres.");

  const { data: q } = await admin
    .from("edu_questions")
    .select("id, module_id, type, prompt, question_keys:edu_question_keys(expected_answer, key_points, source_excerpt)")
    .eq("id", body.question_id)
    .single();
  if (!q || q.type !== "open") throw new HttpError(404, "QUESTION_NOT_FOUND", "Questão não encontrada.");

  const mod = await assertModuleAccess(admin, caller, q.module_id);

  const { data: prev } = await admin
    .from("edu_student_answers")
    .select("attempt")
    .eq("question_id", q.id)
    .eq("student_id", caller.id)
    .order("attempt", { ascending: false })
    .limit(1)
    .maybeSingle();
  const attempt = (prev?.attempt ?? 0) + 1;
  if (attempt > mod.max_attempts && caller.role !== "admin") {
    throw new HttpError(409, "MAX_ATTEMPTS_REACHED", "Você já usou todas as tentativas desta questão.");
  }

  let reference = "";
  if (mod.pdf_file_id) {
    const { data: pdf } = await admin.from("edu_pdf_files").select("extracted_text").eq("id", mod.pdf_file_id).single();
    reference = pdf?.extracted_text ?? "";
  }
  // deno-lint-ignore no-explicit-any
  const key = (Array.isArray((q as any).question_keys) ? (q as any).question_keys[0] : (q as any).question_keys) as
    | { expected_answer: string | null; key_points: string[]; source_excerpt: string | null }
    | null;

  const isExcerpt = reference.length > FULL_REFERENCE_CHARS;
  if (isExcerpt) {
    const query = [q.prompt, key?.expected_answer ?? "", ...(key?.key_points ?? []), answer].join(" ");
    reference = relevantExcerpts(reference, query, EXCERPT_BUDGET_CHARS);
  }
  if (!reference.trim() && !key?.expected_answer) {
    throw new HttpError(400, "NO_REFERENCE", "Esta questão não tem material de referência para correção.");
  }

  const grade = await gradeOpenAnswer({
    reference: reference || "(sem texto do PDF; use a resposta modelo)",
    referenceIsExcerpt: isExcerpt,
    question: q.prompt,
    expectedAnswer: key?.expected_answer ?? null,
    keyPoints: key?.key_points ?? [],
    sourceExcerpt: key?.source_excerpt ?? null,
    studentAnswer: answer,
  });

  const { error } = await admin.from("edu_student_answers").insert({
    question_id: q.id,
    module_id: q.module_id,
    student_id: caller.id,
    attempt,
    answer_text: answer,
    score: grade.score,
    is_correct: grade.score >= PASS_THRESHOLD,
    feedback: grade.feedback,
    feedback_details: {
      verdict: grade.verdict,
      correct_points: grade.correct_points,
      missing_points: grade.missing_points,
      incorrect_points: grade.incorrect_points,
    },
    graded_by: "ai",
    ai_model: AI_MODEL,
  });
  if (error?.code === "23505") throw new HttpError(409, "DUPLICATE_SUBMIT", "Resposta já enviada. Aguarde.");
  if (error) throw new Error(`insert student_answers: ${error.message}`);

  return json(req, {
    ...grade,
    attempt,
    attempts_left: Math.max(mod.max_attempts - attempt, 0),
  });
});
