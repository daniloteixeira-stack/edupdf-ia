import { useEffect, useState } from "react";
import { gradeOpenAnswer } from "../lib/api";
import { friendlyError } from "../lib/supabase";
import { ScoreRing } from "../components/ScoreRing";
import type { OpenGrade, Question, StudentAnswer } from "../lib/types";

interface Props {
  question: Question;
  maxAttempts: number;
  lastAnswer?: StudentAnswer;
  onAnswered: (answer: Partial<StudentAnswer> & { score: number; attempt: number }) => void;
  onNext?: () => void;
}

const TEMPLATE = "Ideia principal:\n\nExplicação (com base no material):\n\nExemplo ou aplicação:\n";
const MIN_CHARS = 10;
const MAX_CHARS = 8000;
const VERDICT_LABEL: Record<OpenGrade["verdict"], string> = {
  correta: "Correta",
  parcialmente_correta: "Parcialmente correta",
  incorreta: "Incorreta",
};

function gradeFromAnswer(a: StudentAnswer): OpenGrade {
  return {
    score: Number(a.score),
    verdict: (a.feedback_details.verdict as OpenGrade["verdict"]) ?? "parcialmente_correta",
    feedback: a.feedback ?? "",
    correct_points: a.feedback_details.correct_points ?? [],
    missing_points: a.feedback_details.missing_points ?? [],
    incorrect_points: a.feedback_details.incorrect_points ?? [],
    attempt: a.attempt,
    attempts_left: 0,
  };
}

/** Questão dissertativa corrigida pela IA contra o PDF, com nota 0–100% e feedback. */
export function OpenQuestion({ question, maxAttempts, lastAnswer, onAnswered, onNext }: Props) {
  const [text, setText] = useState("");
  const [grade, setGrade] = useState<OpenGrade | null>(null);
  const [showGrade, setShowGrade] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Carrega a última tentativa só ao trocar de questão
  useEffect(() => {
    setText(lastAnswer?.answer_text ?? "");
    setGrade(lastAnswer ? { ...gradeFromAnswer(lastAnswer), attempts_left: Math.max(maxAttempts - lastAnswer.attempt, 0) } : null);
    setShowGrade(!!lastAnswer);
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const attemptsUsed = grade?.attempt ?? 0;
  const attemptsLeft = grade ? grade.attempts_left : maxAttempts;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;
  const canSubmit = !busy && text.trim().length >= MIN_CHARS && text.length <= MAX_CHARS && attemptsLeft > 0;

  const submit = async () => {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await gradeOpenAnswer(question.id, text.trim());
      setGrade(res);
      setShowGrade(true);
      onAnswered({
        question_id: question.id,
        answer_text: text.trim(),
        score: res.score,
        is_correct: res.score >= 60,
        attempt: res.attempt,
        feedback: res.feedback,
        feedback_details: res,
      });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const editing = !showGrade || !grade;

  return (
    <div className="question open">
      <div className="q-meta">
        <span className="badge badge-alt">Questão aberta · correção por IA</span>
        {question.source_page && <span className="muted small">Base: página {question.source_page}</span>}
        <span className="muted small">
          Tentativas: {attemptsUsed}/{maxAttempts}
        </span>
      </div>
      <h2 className="q-prompt">{question.prompt}</h2>

      {editing ? (
        <>
          <div className="editor">
            <div className="editor-toolbar">
              <button type="button" className="btn-link" onClick={() => !text.trim() && setText(TEMPLATE)} disabled={!!text.trim()}>
                Usar estrutura sugerida
              </button>
              <span className="muted small">
                {words} palavras · {text.length}/{MAX_CHARS}
              </span>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value.slice(0, MAX_CHARS))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                  e.preventDefault();
                  void submit();
                }
              }}
              rows={10}
              placeholder="Escreva sua resposta com suas palavras. Explique o conceito e, se possível, dê um exemplo."
              disabled={busy}
              aria-label="Sua resposta"
            />
          </div>
          {error && <div className="alert alert-error">{error}</div>}
          <div className="q-actions">
            <span className="muted small hide-sm">Ctrl + Enter envia</span>
            <button type="button" className="btn btn-primary" disabled={!canSubmit} onClick={() => void submit()}>
              {busy ? (
                <>
                  <span className="spinner" /> Corrigindo com IA…
                </>
              ) : (
                "Enviar para correção"
              )}
            </button>
          </div>
        </>
      ) : (
        grade && (
          <div className="grade" aria-live="polite">
            <div className="grade-head">
              <ScoreRing value={grade.score} label="de acerto" />
              <div>
                <span className={`verdict verdict-${grade.verdict}`}>{VERDICT_LABEL[grade.verdict]}</span>
                <p className="grade-feedback">{grade.feedback}</p>
              </div>
            </div>
            <div className="grade-lists">
              <PointList title="O que você acertou" tone="good" items={grade.correct_points} />
              <PointList title="O que faltou" tone="mid" items={grade.missing_points} />
              <PointList title="O que está incorreto" tone="bad" items={grade.incorrect_points} />
            </div>
            <details className="your-answer">
              <summary>Ver sua resposta</summary>
              <p>{text}</p>
            </details>
            <div className="q-actions">
              {grade.attempts_left > 0 && grade.score < 100 && (
                <button type="button" className="btn btn-ghost" onClick={() => setShowGrade(false)}>
                  Reescrever ({grade.attempts_left} restante{grade.attempts_left > 1 ? "s" : ""})
                </button>
              )}
              {onNext && (
                <button type="button" className="btn btn-primary" onClick={onNext}>
                  Próxima →
                </button>
              )}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function PointList({ title, items, tone }: { title: string; items: string[]; tone: "good" | "mid" | "bad" }) {
  if (!items.length) return null;
  return (
    <div className={`points points-${tone}`}>
      <h4>{title}</h4>
      <ul>
        {items.map((p, i) => (
          <li key={i}>{p}</li>
        ))}
      </ul>
    </div>
  );
}
