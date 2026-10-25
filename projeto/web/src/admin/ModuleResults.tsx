import { Fragment, useEffect, useMemo, useState } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import { fmtDate } from "../lib/format";
import type { Module, Profile, Question, StudentAnswer } from "../lib/types";

/** Notas por aluno (última tentativa de cada questão, ponderada pelo peso). */
export function ModuleResults({ module: mod, questions }: { module: Module; questions: Question[] }) {
  const [answers, setAnswers] = useState<StudentAnswer[] | null>(null);
  const [profiles, setProfiles] = useState<Map<string, Pick<Profile, "id" | "email" | "full_name">>>(new Map());
  const [open, setOpen] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase
        .from("edu_student_answers")
        .select("*")
        .eq("module_id", mod.id)
        .order("attempt", { ascending: false });
      if (error) return setError(friendlyError(error));
      const rows = (data ?? []) as StudentAnswer[];
      setAnswers(rows);
      const ids = [...new Set(rows.map((r) => r.student_id))];
      if (ids.length) {
        const { data: p } = await supabase.from("edu_profiles").select("id, email, full_name").in("id", ids);
        setProfiles(new Map((p ?? []).map((x) => [x.id, x])));
      }
    })();
  }, [mod.id]);

  const byStudent = useMemo(() => {
    if (!answers) return [];
    const totalPoints = questions.reduce((s, q) => s + Number(q.points), 0) || 1;
    const points = new Map(questions.map((q) => [q.id, Number(q.points)]));
    const grouped = new Map<string, Map<string, StudentAnswer>>();
    for (const a of answers) {
      const m = grouped.get(a.student_id) ?? new Map<string, StudentAnswer>();
      if (!m.has(a.question_id)) m.set(a.question_id, a);
      grouped.set(a.student_id, m);
    }
    return [...grouped.entries()]
      .map(([studentId, latest]) => {
        const list = [...latest.values()];
        const earned = list.reduce((s, a) => s + Number(a.score) * (points.get(a.question_id) ?? 1), 0);
        return {
          studentId,
          latest,
          answered: list.length,
          score: Math.round(earned / totalPoints),
          last: list.reduce((d, a) => (a.created_at > d ? a.created_at : d), ""),
        };
      })
      .sort((a, b) => b.score - a.score);
  }, [answers, questions]);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!answers) return <div className="loading">Carregando…</div>;
  if (!byStudent.length) return <div className="empty">Nenhum aluno respondeu ainda.</div>;

  return (
    <div className="table-wrap">
      <table className="table">
        <thead>
          <tr>
            <th>Aluno</th>
            <th>Respondidas</th>
            <th>Nota</th>
            <th>Situação</th>
            <th>Última resposta</th>
          </tr>
        </thead>
        <tbody>
          {byStudent.map((r) => {
            const p = profiles.get(r.studentId);
            const complete = r.answered === questions.length;
            return (
              <Fragment key={r.studentId}>
                <tr onClick={() => setOpen(open === r.studentId ? null : r.studentId)}>
                  <td>
                    <strong>{p?.full_name || p?.email || r.studentId.slice(0, 8)}</strong>
                    <div className="muted small">{p?.email}</div>
                  </td>
                  <td>
                    {r.answered}/{questions.length}
                  </td>
                  <td>
                    <strong>{r.score}%</strong>
                  </td>
                  <td>
                    {!complete ? (
                      <span className="status status-paused">Em andamento</span>
                    ) : r.score >= Number(mod.pass_score) ? (
                      <span className="status status-active">Aprovado</span>
                    ) : (
                      <span className="status status-blocked">Reprovado</span>
                    )}
                  </td>
                  <td>{fmtDate(r.last)}</td>
                </tr>
                {open === r.studentId && (
                  <tr className="detail-row">
                    <td colSpan={5}>
                      <ol className="answer-detail">
                        {questions.map((q) => {
                          const a = r.latest.get(q.id);
                          return (
                            <li key={q.id}>
                              <div className="row between">
                                <span>{q.prompt}</span>
                                <strong>{a ? `${Math.round(Number(a.score))}%` : "—"}</strong>
                              </div>
                              {a?.answer_text && <p className="small muted">Resposta: {a.answer_text}</p>}
                              {a?.graded_by === "ai" && a.feedback && <p className="small">Feedback da IA: {a.feedback}</p>}
                              {a && <p className="small muted">Tentativa {a.attempt}</p>}
                            </li>
                          );
                        })}
                      </ol>
                    </td>
                  </tr>
                )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
