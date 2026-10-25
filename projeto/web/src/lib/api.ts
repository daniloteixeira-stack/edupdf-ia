import { FunctionsHttpError } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { McResult, OpenGrade } from "./types";

/** Chama uma Edge Function e devolve o corpo JSON, com a mensagem de erro do servidor. */
export async function callFunction<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (error) {
    if (error instanceof FunctionsHttpError) {
      const payload = await error.context.json().catch(() => null);
      throw new Error(payload?.message ?? payload?.error ?? "Erro no servidor.");
    }
    throw error;
  }
  return data as T;
}

export async function submitMultipleChoice(questionId: string, optionId: string): Promise<McResult> {
  const { data, error } = await supabase.rpc("edu_submit_mc_answer", {
    p_question_id: questionId,
    p_option_id: optionId,
  });
  if (error) throw error;
  return data as McResult;
}

export const gradeOpenAnswer = (questionId: string, answerText: string) =>
  callFunction<OpenGrade>("edu-grade-open-answer", { question_id: questionId, answer_text: answerText });

export const generateQuestions = (params: {
  module_id: string;
  multiple_choice: number;
  open: number;
  difficulty: "facil" | "medio" | "dificil";
  page_from?: number | null;
  page_to?: number | null;
  instructions?: string;
}) => callFunction<{ created: number }>("edu-generate-questions", params);

export type AdminAction =
  | { action: "pause" | "block"; user_id: string; reason?: string }
  | { action: "reactivate" | "send_reset"; user_id: string }
  | { action: "set_password"; user_id: string; password: string }
  | { action: "set_role"; user_id: string; role: "admin" | "student" }
  | { action: "create_user"; email: string; full_name?: string; password: string };

export const adminUsers = (payload: AdminAction) => callFunction<{ ok: boolean }>("edu-admin-users", payload);

export const pdfStorage = {
  signUpload: () => callFunction<{ path: string; token: string }>("edu-pdf-storage", { action: "sign_upload" }),
  signDownload: (path: string) => callFunction<{ url: string }>("edu-pdf-storage", { action: "sign_download", path }),
  remove: (path: string) => callFunction<{ ok: boolean }>("edu-pdf-storage", { action: "remove", path }),
};
