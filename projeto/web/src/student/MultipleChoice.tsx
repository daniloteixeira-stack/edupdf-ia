import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { submitMultipleChoice } from "../lib/api";
import { friendlyError } from "../lib/supabase";
import { newSeed, seededShuffle } from "../lib/shuffle";
import type { McResult, Question, StudentAnswer } from "../lib/types";

interface Props {
  question: Question;
  shuffle: boolean;
  maxAttempts: number;
  lastAnswer?: StudentAnswer;
  onAnswered: (answer: Partial<StudentAnswer> & { score: number; attempt: number }) => void;
  onNext?: () => void;
}

const LETTERS = "ABCDEFGH";

/**
 * Múltipla escolha com:
 * - alternativas embaralhadas (animação FLIP suave ao reordenar);
 * - teclado: 1–8 ou A–H escolhe, ↑/↓ navega, Enter confirma/avança, S embaralha;
 * - correção no servidor (o gabarito nunca chega ao aluno antes da resposta).
 */
export function MultipleChoice({ question, shuffle, maxAttempts, lastAnswer, onAnswered, onNext }: Props) {
  const [seed, setSeed] = useState(newSeed);
  const [selected, setSelected] = useState<string | null>(null);
  const [focusIndex, setFocusIndex] = useState(0);
  const [result, setResult] = useState<McResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attemptsUsed, setAttemptsUsed] = useState(lastAnswer?.attempt ?? 0);

  const options = useMemo(
    () => (shuffle ? seededShuffle(question.options, seed) : question.options),
    [question.options, shuffle, seed],
  );

  // Reinicia ao trocar de questão
  useEffect(() => {
    setSelected(null);
    setResult(null);
    setError(null);
    setFocusIndex(0);
    setSeed(newSeed());
    setAttemptsUsed(lastAnswer?.attempt ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [question.id]);

  const attemptsLeft = Math.max(maxAttempts - attemptsUsed, 0);
  const lastWasCorrect = !result && !!lastAnswer?.is_correct && attemptsUsed === lastAnswer.attempt;
  const locked = !!result || busy || attemptsLeft === 0 || lastWasCorrect;

  // ---- animação FLIP ----------------------------------------------------
  const itemRefs = useRef(new Map<string, HTMLButtonElement>());
  const lastTops = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    itemRefs.current.forEach((el, id) => {
      const top = el.getBoundingClientRect().top;
      const prev = lastTops.current.get(id);
      if (!reduce && prev !== undefined && prev !== top) {
        el.style.transition = "none";
        el.style.transform = `translateY(${prev - top}px)`;
        void el.offsetHeight; // força reflow
        el.style.transition = "transform 380ms cubic-bezier(.2,.8,.2,1)";
        el.style.transform = "";
      }
      lastTops.current.set(id, top);
    });
  }, [options]);

  const reshuffle = useCallback(() => {
    if (result || !shuffle) return;
    setSeed(newSeed());
  }, [result, shuffle]);

  const submit = useCallback(async () => {
    if (!selected || locked) return;
    setBusy(true);
    setError(null);
    try {
      const res = await submitMultipleChoice(question.id, selected);
      setResult(res);
      setAttemptsUsed(res.attempt);
      onAnswered({
        question_id: question.id,
        selected_option_id: selected,
        score: res.score,
        is_correct: res.is_correct,
        attempt: res.attempt,
        feedback: res.explanation,
      });
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  }, [selected, locked, question.id, onAnswered]);

  const retry = () => {
    setResult(null);
    setSelected(null);
    setFocusIndex(0);
    if (shuffle) setSeed(newSeed());
  };

  // ---- teclado -----------------------------------------------------------
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toUpperCase();
      const byNumber = Number(key) - 1;
      const byLetter = LETTERS.indexOf(key);
      const pick = !Number.isNaN(byNumber) && byNumber >= 0 && byNumber < options.length ? byNumber : byLetter;

      if (!result && pick >= 0 && pick < options.length && key.length === 1) {
        setSelected(options[pick].id);
        setFocusIndex(pick);
        e.preventDefault();
      } else if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        if (result) return;
        const next = (focusIndex + (e.key === "ArrowDown" ? 1 : -1) + options.length) % options.length;
        setFocusIndex(next);
        setSelected(options[next].id);
        itemRefs.current.get(options[next].id)?.focus();
        e.preventDefault();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (!result) void submit();
        else onNext?.();
      } else if (key === "S" && !result) {
        reshuffle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [options, focusIndex, result, submit, onNext, reshuffle]);

  const stateOf = (id: string) => {
    if (!result) return selected === id ? "selected" : "";
    if (id === result.correct_option_id) return "correct";
    if (id === selected) return "wrong";
    return "dim";
  };

  return (
    <div className="question mc">
      <div className="q-meta">
        <span className="badge">Múltipla escolha</span>
        {question.source_page && <span className="muted small">Base: página {question.source_page}</span>}
        <span className="muted small">
          Tentativas: {attemptsUsed}/{maxAttempts}
        </span>
      </div>
      <h2 className="q-prompt">{question.prompt}</h2>

      <div className="options" role="radiogroup" aria-label="Alternativas">
        {options.map((opt, i) => (
          <button
            key={opt.id}
            ref={(el) => {
              if (el) itemRefs.current.set(opt.id, el);
              else itemRefs.current.delete(opt.id);
            }}
            type="button"
            role="radio"
            aria-checked={selected === opt.id}
            className={`option ${stateOf(opt.id)}`}
            disabled={locked && !result}
            onClick={() => {
              if (result) return;
              setSelected(opt.id);
              setFocusIndex(i);
            }}
            onDoubleClick={() => !result && void submit()}
          >
            <kbd className="option-key">{LETTERS[i]}</kbd>
            <span className="option-text">{opt.text}</span>
            {result && opt.id === result.correct_option_id && <span className="option-mark">✓</span>}
            {result && opt.id === selected && !result.is_correct && <span className="option-mark">✗</span>}
          </button>
        ))}
      </div>

      {error && <div className="alert alert-error">{error}</div>}
      {lastWasCorrect && <div className="alert alert-success">Você já acertou esta questão (100%).</div>}

      {result && (
        <div className={`feedback ${result.is_correct ? "feedback-good" : "feedback-bad"}`} aria-live="polite">
          <strong>{result.is_correct ? "Resposta correta! +100%" : "Não foi dessa vez."}</strong>
          {result.explanation && <p>{result.explanation}</p>}
        </div>
      )}

      <div className="q-actions">
        {!result && shuffle && (
          <button type="button" className="btn btn-ghost" onClick={reshuffle} title="Atalho: S">
            ⤨ Embaralhar
          </button>
        )}
        <span className="muted small hide-sm">Atalhos: A–{LETTERS[options.length - 1]} / 1–{options.length}, ↑↓, Enter, S embaralha</span>
        {!result && (
          <button type="button" className="btn btn-primary" disabled={!selected || locked} onClick={() => void submit()}>
            {busy ? "Corrigindo…" : attemptsLeft === 0 ? "Sem tentativas" : "Confirmar"}
          </button>
        )}
        {result && !result.is_correct && result.attempts_left > 0 && (
          <button type="button" className="btn btn-ghost" onClick={retry}>
            Tentar de novo ({result.attempts_left})
          </button>
        )}
        {result && onNext && (
          <button type="button" className="btn btn-primary" onClick={onNext}>
            Próxima →
          </button>
        )}
      </div>
    </div>
  );
}
