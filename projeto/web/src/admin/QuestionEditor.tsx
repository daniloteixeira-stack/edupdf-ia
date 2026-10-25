import { useState } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import type { Question, QuestionKey, QuestionOption, QuestionType } from "../lib/types";

interface Props {
  moduleId: string;
  position: number;
  question?: Question;
  answerKey?: QuestionKey;
  type?: QuestionType;
  onSaved: () => void;
  onCancel: () => void;
}

const shortId = () => crypto.randomUUID().slice(0, 8);

/** Edita (ou cria) uma questão e seu gabarito. */
export function QuestionEditor({ moduleId, position, question, answerKey, type: newType, onSaved, onCancel }: Props) {
  const type = question?.type ?? newType ?? "multiple_choice";
  const [prompt, setPrompt] = useState(question?.prompt ?? "");
  const [options, setOptions] = useState<QuestionOption[]>(
    question?.options?.length ? question.options : type === "multiple_choice" ? [1, 2, 3, 4].map(() => ({ id: shortId(), text: "" })) : [],
  );
  const [correct, setCorrect] = useState(answerKey?.correct_option_id ?? null);
  const [explanation, setExplanation] = useState(answerKey?.explanation ?? "");
  const [expected, setExpected] = useState(answerKey?.expected_answer ?? "");
  const [keyPoints, setKeyPoints] = useState((answerKey?.key_points ?? []).join("\n"));
  const [points, setPoints] = useState(question?.points ?? 1);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const valid =
    prompt.trim().length > 0 &&
    (type === "open"
      ? expected.trim().length > 0
      : options.filter((o) => o.text.trim()).length >= 2 && !!correct && options.some((o) => o.id === correct && o.text.trim()));

  const save = async () => {
    if (!valid) return;
    setBusy(true);
    setError(null);
    try {
      const cleanOptions = type === "multiple_choice" ? options.filter((o) => o.text.trim()).map((o) => ({ ...o, text: o.text.trim() })) : [];
      const payload = { module_id: moduleId, type, prompt: prompt.trim(), options: cleanOptions, points: Number(points) || 1 };
      let id = question?.id;
      if (id) {
        const { error } = await supabase.from("edu_questions").update(payload).eq("id", id);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("edu_questions").insert({ ...payload, position }).select("id").single();
        if (error) throw error;
        id = data.id;
      }
      const { error: kErr } = await supabase.from("edu_question_keys").upsert({
        question_id: id,
        correct_option_id: type === "multiple_choice" ? correct : null,
        explanation: explanation.trim() || null,
        expected_answer: type === "open" ? expected.trim() : null,
        key_points: type === "open" ? keyPoints.split("\n").map((s) => s.trim()).filter(Boolean) : [],
        source_excerpt: answerKey?.source_excerpt ?? null,
      });
      if (kErr) throw kErr;
      onSaved();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="q-editor">
      <label className="field">
        <span>Enunciado</span>
        <textarea rows={3} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
      </label>

      {type === "multiple_choice" ? (
        <div className="field">
          <span>Alternativas (marque a correta)</span>
          {options.map((o, i) => (
            <div key={o.id} className="row gap option-edit">
              <input type="radio" name={`correct-${question?.id ?? "new"}`} checked={correct === o.id} onChange={() => setCorrect(o.id)} aria-label="Correta" />
              <input
                className="grow"
                value={o.text}
                placeholder={`Alternativa ${i + 1}`}
                onChange={(e) => setOptions((prev) => prev.map((x) => (x.id === o.id ? { ...x, text: e.target.value } : x)))}
              />
              <button type="button" className="btn-icon" disabled={options.length <= 2} onClick={() => setOptions((prev) => prev.filter((x) => x.id !== o.id))} aria-label="Remover">
                ×
              </button>
            </div>
          ))}
          {options.length < 8 && (
            <button type="button" className="btn-link" onClick={() => setOptions((prev) => [...prev, { id: shortId(), text: "" }])}>
              + alternativa
            </button>
          )}
        </div>
      ) : (
        <>
          <label className="field">
            <span>Resposta modelo</span>
            <textarea rows={4} value={expected} onChange={(e) => setExpected(e.target.value)} />
          </label>
          <label className="field">
            <span>Pontos-chave para a correção (um por linha)</span>
            <textarea rows={4} value={keyPoints} onChange={(e) => setKeyPoints(e.target.value)} />
          </label>
        </>
      )}

      <label className="field">
        <span>Explicação mostrada ao aluno depois de responder</span>
        <textarea rows={2} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      <label className="field inline">
        <span>Peso</span>
        <input type="number" min={0.5} step={0.5} value={points} onChange={(e) => setPoints(Number(e.target.value))} />
      </label>
      {error && <div className="alert alert-error">{error}</div>}
      <div className="row gap end">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={!valid || busy} onClick={() => void save()}>
          {busy ? "Salvando…" : "Salvar questão"}
        </button>
      </div>
    </div>
  );
}
