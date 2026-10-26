import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import type { LessonSlide, Module, MyProgress, Question, StudentAnswer } from "../lib/types";
import { useAuth } from "../auth/AuthProvider";
import { MultipleChoice } from "./MultipleChoice";
import { OpenQuestion } from "./OpenQuestion";
import { SlideView } from "./SlideView";
import { ScoreRing } from "../components/ScoreRing";

type Latest = Partial<StudentAnswer> & { score: number; attempt: number };
/** Um passo do módulo: slide de aula ou questão, na ordem de `position`. */
type Item = { kind: "slide"; slide: LessonSlide } | { kind: "question"; question: Question };

/** Percorre a aula (slides) e as questões do módulo e mostra o resultado final em %. */
export function ModulePlayer() {
  const { id } = useParams<{ id: string }>();
  const { profile } = useAuth();
  const [mod, setMod] = useState<Module | null>(null);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [slides, setSlides] = useState<LessonSlide[]>([]);
  const [latest, setLatest] = useState<Map<string, Latest>>(new Map());
  const [index, setIndex] = useState(0);
  const [finished, setFinished] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    (async () => {
      setLoading(true);
      const [m, q, a, p, sl] = await Promise.all([
        supabase.from("edu_modules").select("*").eq("id", id).maybeSingle(),
        supabase.from("edu_questions").select("*").eq("module_id", id).order("position"),
        supabase.from("edu_student_answers").select("*").eq("module_id", id).order("attempt", { ascending: false }),
        supabase.rpc("edu_my_progress"),
        supabase.from("edu_lesson_slides").select("*").eq("module_id", id).order("position"),
      ]);
      setLoading(false);
      if (m.error || q.error || a.error) return setError(friendlyError(m.error ?? q.error ?? a.error));
      if (!m.data) return setError("Módulo não encontrado ou não liberado.");
      // Trilha: o módulo só abre depois que o anterior é aprovado (professor vê tudo).
      const step = (p.data as MyProgress | null)?.modules.find((mm) => mm.id === id);
      if (step && !step.unlocked && profile?.role !== "admin") {
        return setError("Este módulo ainda está trancado. Conclua o módulo anterior da trilha para liberar.");
      }
      const map = new Map<string, StudentAnswer>();
      for (const ans of (a.data ?? []) as StudentAnswer[]) if (!map.has(ans.question_id)) map.set(ans.question_id, ans);
      const qs = (q.data ?? []) as Question[];
      const ss = (sl.data ?? []) as LessonSlide[];
      setMod(m.data as Module);
      setQuestions(qs);
      setSlides(ss);
      setLatest(new Map(map));
      // Começa nos slides que antecedem a primeira questão ainda não respondida.
      const seq = buildItems(ss, qs);
      let start = seq.findIndex((it) => it.kind === "question" && !map.has(it.question.id));
      if (start === -1) start = map.size ? seq.findIndex((it) => it.kind === "question") : 0;
      while (start > 0 && seq[start - 1].kind === "slide") start--;
      setIndex(Math.max(0, start));
    })();
  }, [id, profile?.role]);

  const items = useMemo(() => buildItems(slides, questions), [slides, questions]);

  const onAnswered = useCallback((answer: Latest) => {
    setLatest((prev) => new Map(prev).set(answer.question_id!, answer));
  }, []);

  const totalPoints = useMemo(() => questions.reduce((s, q) => s + Number(q.points), 0), [questions]);
  const scorePct = useMemo(() => {
    if (!totalPoints) return 0;
    const earned = questions.reduce((s, q) => s + (latest.get(q.id)?.score ?? 0) * Number(q.points), 0);
    return Math.round(earned / totalPoints);
  }, [questions, latest, totalPoints]);

  // Mesma regra do servidor: até 10 XP por questão e +20 ao aprovar.
  const moduleXp = useMemo(() => {
    const fromQuestions = questions.reduce((s, q) => s + Math.round((latest.get(q.id)?.score ?? 0) / 10), 0);
    return fromQuestions + (questions.length && scorePct >= Number(mod?.pass_score ?? 101) ? 20 : 0);
  }, [questions, latest, scorePct, mod?.pass_score]);

  const next = useCallback(() => {
    if (index < items.length - 1) setIndex((i) => i + 1);
    else setFinished(true);
  }, [index, items.length]);
  const prev = useCallback(() => setIndex((i) => Math.max(0, i - 1)), []);

  if (loading) return <div className="loading">Carregando módulo…</div>;
  if (error || !mod) return <div className="alert alert-error">{error}</div>;
  if (!items.length) return <div className="empty">Este módulo ainda não tem conteúdo.</div>;

  const item = items[Math.min(index, items.length - 1)];
  const questionNumber = (i: number) => items.slice(0, i + 1).filter((it) => it.kind === "question").length;
  const slideNumber = (i: number) => items.slice(0, i + 1).filter((it) => it.kind === "slide").length;
  const answered = questions.filter((qq) => latest.has(qq.id)).length;
  const passed = scorePct >= Number(mod.pass_score);

  return (
    <div className="page player">
      <header className="player-head">
        <Link to="/aluno" className="btn-link">
          ← Trilha
        </Link>
        <h1>{mod.title}</h1>
        <div className="progress" aria-label={`${answered} de ${questions.length} respondidas`}>
          <div style={{ width: `${(answered / questions.length) * 100}%` }} />
        </div>
        <nav className="dots" aria-label="Aula e questões">
          {items.map((it, i) => {
            const go = () => {
              setFinished(false);
              setIndex(i);
            };
            const current = i === index && !finished ? "current" : "";
            if (it.kind === "slide") {
              return (
                <button key={it.slide.id} className={`dot dot-slide ${current}`} onClick={go} aria-label={`Slide ${slideNumber(i)}: ${it.slide.title}`} title={it.slide.title}>
                  📖
                </button>
              );
            }
            const a = latest.get(it.question.id);
            const tone = !a ? "" : a.score >= 80 ? "good" : a.score >= 40 ? "mid" : "bad";
            return (
              <button key={it.question.id} className={`dot ${tone} ${current}`} onClick={go} aria-label={`Questão ${questionNumber(i)}`}>
                {questionNumber(i)}
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
          {moduleXp > 0 && <span className="xp-gain">⚡ {moduleXp} XP neste módulo</span>}
          {passed && <p className="muted">O próximo módulo da trilha foi liberado.</p>}
          <p className="muted">
            {answered} de {questions.length} questões respondidas · nota mínima {Number(mod.pass_score)}%
          </p>
          {answered < questions.length && (
            <button className="btn btn-primary" onClick={() => {
              setFinished(false);
              setIndex(items.findIndex((it) => it.kind === "question" && !latest.has(it.question.id)));
            }}>
              Responder as que faltam
            </button>
          )}
        </section>
      ) : item.kind === "slide" ? (
        <section className="card">
          <SlideView slide={item.slide} index={slideNumber(index) - 1} total={slides.length} onNext={next} onPrev={index > 0 ? prev : undefined} />
        </section>
      ) : (
        <QuestionCard
          q={item.question}
          number={questionNumber(index)}
          total={questions.length}
          mod={mod}
          lastAnswer={latest.get(item.question.id) as StudentAnswer | undefined}
          onAnswered={onAnswered}
          onNext={next}
        />
      )}
    </div>
  );
}

function QuestionCard(props: {
  q: Question;
  number: number;
  total: number;
  mod: Module;
  lastAnswer: StudentAnswer | undefined;
  onAnswered: (a: Latest) => void;
  onNext: () => void;
}) {
  const { q, number, total, mod, lastAnswer, onAnswered, onNext: next } = props;
  return (
    <section className="card">
      <div className="muted small">
        Questão {number} de {total}
      </div>
      {q.type === "multiple_choice" ? (
        <MultipleChoice
          key={q.id}
          question={q}
          shuffle={mod.shuffle_options}
          maxAttempts={mod.max_attempts}
          lastAnswer={lastAnswer}
          onAnswered={onAnswered}
          onNext={next}
        />
      ) : (
        <OpenQuestion key={q.id} question={q} maxAttempts={mod.max_attempts} lastAnswer={lastAnswer} onAnswered={onAnswered} onNext={next} />
      )}
    </section>
  );
}

/** Junta slides e questões pela posição; no empate, o slide vem antes. */
function buildItems(slides: LessonSlide[], questions: Question[]): Item[] {
  const all: Array<Item & { pos: number; order: number }> = [
    ...slides.map((slide) => ({ kind: "slide" as const, slide, pos: slide.position, order: 0 })),
    ...questions.map((question) => ({ kind: "question" as const, question, pos: question.position, order: 1 })),
  ];
  return all.sort((a, b) => a.pos - b.pos || a.order - b.order);
}
