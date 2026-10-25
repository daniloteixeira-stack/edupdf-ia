import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import type { Module, Question, StudentAnswer } from "../lib/types";
import { MultipleChoice } from "./MultipleChoice";
import { OpenQuestion } from "./OpenQuestion";
import { ScoreRing } from "../components/ScoreRing";

type Latest = Partial<StudentAnswer> & { score: number; attempt: number };

/** Percorre as questões do módulo e mostra o resultado final em %. */
export function ModulePlayer() {
  const { id } = useParams<{ id: string }>();
  const [mod, setMod] = useState<Module | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [latest, setLatest] = useState<Map<string, Latest>>(new Map());
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [m, q, a] = await Promise.all([
        supabase.from("edu_modules").select("*").eq("id", id).maybeSingle(),
        supabase.from("edu_questions").select("*").eq("module_id", id).order("position"),
        supabase.from("edu_student_answers").select("*").eq("module_id", id).order("attempt", { ascending: false }),
      ]);
      setLoading(false);
      if (m.error || q.error || a.error) return setError(friendlyError(m.error ?? q.error ?? a.error));
      if (!m.data) return setError("Módulo não encontrado ou não liberado.");
      const map = new Map<string, StudentAnswer>();
      for (const ans of (a.data ?? []) as StudentAnswer[]) if (!map.has(ans.question_id)) map.set(ans.question_id, ans);
      setMod(m.data as Module);
      setQuestions((q.data ?? []) as Question[]);
      setLatest(new Map(map));
      // começa na primeira questão ainda não respondida
      const firstOpen = (q.data ?? []).findIndex((qq) => !map.has(qq.id));
      setIndex(firstOpen === -1 ? 0 : firstOpen);
    })();
  }, [id]);

  const onAnswered = useCallback((answer: Latest) => {
    setLatest((prev) => new Map(prev).set(answer.question_id!, answer));
  }, []);

  const totalPoints = useMemo(() => questions.reduce((s, q) => s + Number(q.points), 0), [questions]);
  const scorePct = useMemo(() => {
    if (!totalPoints) return 0;
    const earned = questions.reduce((s, q) => s + (latest.get(q.id)?.score ?? 0) * Number(q.points), 0);
    return Math.round(earned / totalPoints);
  }, [questions, latest, totalPoints]);

  const next = useCallback(() => {
    if (index < questions.length - 1) setIndex((i) => i + 1);
    else setFinished(true);
  }, [index, questions.length]);

  if (loading) return <div className="loading">Carregando módulo…</div>;
  if (error || !mod) return <div className="alert alert-error">{error}</div>;
  if (!questions.length) return <div className="empty">Este módulo ainda não tem questões.</div>;

  const q = questions[index];
  const answered = questions.filter((qq) => latest.has(qq.id)).length;
  const passed = scorePct >= Number(mod.pass_score);

  return (
    <div className="page player">
      <header className="player-head">
        <Link to="/aluno" className="btn-link">
          ← Módulos
        </Link>
        <h1>{mod.title}</h1>
        <div className="progress" aria-label={`${answered} de ${questions.length} respondidas`}>
          <div style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
        <nav className="dots" aria-label="Questões">
          {questions.map((qq, i) => {
            const a = latest.get(qq.id);
            const tone = !a ? "" : a.score >= 80 ? "good" : a.score >= 40 ? "mid" : "bad";
            return (
              <button
                key={qq.id}
                className={`dot ${tone} ${i === index && !finished ? "current" : ""}`}
                onClick={() => {
                  setFinished(false);
                  setIndex(i);
                }}
                aria-label={`Questão ${i + 1}`}
              >
                {i + 1}
              </button>
            );
          })}
          <button className={`dot dot-result ${finished ? "current" : ""}`} onClick={() => setFinished(true)}>
            %
          </button>
        </nav>
      </header>

      {finished ? (
        <section className="card result">
          <ScoreRing value={scorePct} size={160} label="nota do módulo" />
          <h2>{passed ? "Parabéns, você foi aprovado!" : "Continue praticando"}</h2>
          <p className="muted">
            {answered} de {questions.length} questões respondidas · nota mínima {Number(mod.pass_score)}%
          </p>
          {answered < questions.length && (
            <button className="btn btn-primary" onClick={() => {
              setFinished(false);
              setIndex(questions.findIndex((qq) => !latest.has(qq.id)));
            }}>
              Responder as que faltam
            </button>
          )}
        </section>
      ) : (
        <section className="card">
          <div className="muted small">
            Questão {index + 1} de {questions.length}
          </div>
          {q.type === "multiple_choice" ? (
            <MultipleChoice
              key={q.id}
              question={q}
              shuffle={mod.shuffle_options}
              maxAttempts={mod.max_attempts}
              lastAnswer={latest.get(q.id) as StudentAnswer | undefined}
              onAnswered={onAnswered}
              onNext={next}
            />
          ) : (
            <OpenQuestion key={q.id} question={q} maxAttempts={mod.max_attempts} lastAnswer={latest.get(q.id) as StudentAnswer | undefined} onAnswered={onAnswered} onNext={next} />
          )}
        </section>
      )}
    </div>
  );
}
