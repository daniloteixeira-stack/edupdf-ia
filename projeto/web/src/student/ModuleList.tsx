import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import type { MyProgress, TrailModule } from "../lib/types";

const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

/** Trilha do aluno: módulos em sequência com cadeado, XP e ofensiva. */
export function ModuleList() {
  const [progress, setProgress] = useState<MyProgress | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.rpc("edu_my_progress");
      if (error) return setError(friendlyError(error));
      setProgress(data as MyProgress);
    })();
  }, []);

  if (error) return <div className="alert alert-error">{error}</div>;
  if (!progress) return <div className="loading">Carregando sua trilha…</div>;

  const current = progress.modules.find((m) => m.unlocked && !m.passed);
  const allDone = progress.modules.length > 0 && progress.modules.every((m) => m.passed);

  return (
    <div className="page">
      <header className="page-head">
        <h1>Minha trilha</h1>
        <p className="muted">Avance um módulo de cada vez. O próximo abre quando você atinge a nota mínima.</p>
      </header>

      <section className="stats-bar">
        <div className={`stat ${progress.streak_days > 0 ? "stat-streak" : ""}`}>
          <span className="stat-icon" aria-hidden="true">🔥</span>
          <div>
            <strong>{progress.streak_days} {progress.streak_days === 1 ? "dia" : "dias"}</strong>
            <span className="muted small">ofensiva{progress.best_streak > progress.streak_days ? ` · recorde ${progress.best_streak}` : ""}</span>
          </div>
        </div>
        <div className="stat stat-xp">
          <span className="stat-icon" aria-hidden="true">⚡</span>
          <div>
            <strong>{progress.xp_total} XP</strong>
            <span className="muted small">+{progress.xp_today} hoje</span>
          </div>
        </div>
        <div className="week" aria-label="Dias com estudo nesta semana">
          {progress.week.map((d) => {
            const date = new Date(`${d.day}T12:00:00`);
            return (
              <span key={d.day} className={`week-day ${d.active ? "on" : ""}`} title={date.toLocaleDateString("pt-BR")}>
                {WEEKDAYS[date.getDay()]}
              </span>
            );
          })}
        </div>
      </section>

      {progress.streak_days === 0 && progress.xp_total > 0 && (
        <div className="alert alert-info">Responda uma questão hoje para começar uma nova ofensiva.</div>
      )}

      {progress.modules.length === 0 ? (
        <div className="empty">Nenhum módulo liberado ainda. Quando o professor publicar, ele aparece aqui.</div>
      ) : (
        <ol className="trail">
          {progress.modules.map((m) => (
            <TrailNode key={m.id} module={m} isCurrent={m.id === current?.id} />
          ))}
          {allDone && <li className="trail-end">🏆 Trilha concluída! Parabéns.</li>}
        </ol>
      )}
    </div>
  );
}

function TrailNode({ module: m, isCurrent }: { module: TrailModule; isCurrent: boolean }) {
  const state = m.passed ? "done" : m.unlocked ? "open" : "locked";
  const pct = m.question_count ? Math.round((m.answered / m.question_count) * 100) : 0;
  const icon = m.passed ? "✓" : m.unlocked ? m.step : "🔒";

  const body = (
    <>
      <span className={`trail-circle ${state} ${isCurrent ? "current" : ""}`} aria-hidden="true">
        {icon}
      </span>
      <span className="trail-info">
        <strong>{m.title}</strong>
        <span className="muted small">
          {state === "locked"
            ? "Conclua o módulo anterior para liberar"
            : m.passed
              ? `Aprovado com ${m.score_pct}%`
              : m.answered
                ? `${m.answered}/${m.question_count} questões · ${m.score_pct}% (mínimo ${Number(m.pass_score)}%)`
                : `${m.question_count} questões · mínimo ${Number(m.pass_score)}%`}
        </span>
        {state === "open" && m.answered > 0 && (
          <span className="progress" aria-label={`Progresso ${pct}%`}>
            <span style={{ width: `${pct}%` }} />
          </span>
        )}
        {isCurrent && <span className="btn btn-primary btn-sm">{m.answered ? "Continuar" : "Começar"}</span>}
      </span>
    </>
  );

  return (
    <li className={`trail-step ${state}`}>
      {state === "locked" ? (
        <div className="trail-node" aria-disabled="true">
          {body}
        </div>
      ) : (
        <Link to={`/aluno/modulo/${m.id}`} className="trail-node">
          {body}
        </Link>
      )}
    </li>
  );
}
