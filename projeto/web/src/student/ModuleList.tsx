import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import type { Module } from "../lib/types";

interface Row extends Module {
  question_count: number;
  answered: number;
  avg_score: number | null;
}

/** Módulos liberados pelo professor + progresso do aluno. */
export function ModuleList() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: mods, error: mErr }, { data: answers, error: aErr }] = await Promise.all([
        supabase.from("edu_modules").select("*, questions:edu_questions(count)").eq("is_published", true).order("created_at", { ascending: false }),
        supabase.from("edu_student_answers").select("module_id, question_id, attempt, score").order("attempt", { ascending: false }),
      ]);
      if (mErr || aErr) return setError(friendlyError(mErr ?? aErr));

      // última tentativa de cada questão
      const latest = new Map<string, { module_id: string; score: number }>();
      for (const a of answers ?? []) if (!latest.has(a.question_id)) latest.set(a.question_id, a);

      setRows(
        (mods ?? []).map((m) => {
          const mine = [...latest.values()].filter((a) => a.module_id === m.id);
          const count = ((m as { questions?: Array<{ count: number }> }).questions?.[0]?.count as number) ?? 0;
          return {
            ...(m as Module),
            question_count: count,
            answered: mine.length,
            avg_score: mine.length ? mine.reduce((s, a) => s + Number(a.score), 0) / mine.length : null,
          };
        }),
      );
    })();
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!rows) return <div className="loading">Carregando módulos…</div>;

  return (
    <div className="page">
      <header className="page-head">
        <h1>Meus módulos</h1>
        <p className="muted">Escolha um módulo para praticar. Seu progresso é salvo automaticamente.</p>
      </header>
      {rows.length === 0 ? (
        <div className="empty">Nenhum módulo liberado ainda. Quando o professor publicar, ele aparece aqui.</div>
      ) : (
        <div className="grid">
          {rows.map((m) => {
            const pct = m.question_count ? Math.round((m.answered / m.question_count) * 100) : 0;
            const done = m.question_count > 0 && m.answered === m.question_count;
            return (
              <Link key={m.id} to={`/aluno/modulo/${m.id}`} className="card module-card">
                <div className="module-card-top">
                  <h3>{m.title}</h3>
                  {done && <span className={`badge ${Number(m.avg_score) >= m.pass_score ? "badge-good" : "badge-bad"}`}>{Math.round(m.avg_score ?? 0)}%</span>}
                </div>
                {m.description && <p className="muted clamp-2">{m.description}</p>}
                <div className="progress" aria-label={`Progresso ${pct}%`}>
                  <div style={{ width: `${pct}%` }} />
                </div>
                <div className="row between small muted">
                  <span>
                    {m.answered}/{m.question_count} questões
                  </span>
                  <span>Aprovação: {Number(m.pass_score)}%</span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
