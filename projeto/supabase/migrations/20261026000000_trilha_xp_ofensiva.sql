-- =====================================================================
-- Trilha, XP e ofensiva (estilo Duolingo)
--   * edu_modules.trail_position: ordem do módulo na trilha (definida pelo professor)
--   * edu_my_progress(): progresso do aluno logado, calculado a partir das
--     respostas (nada novo para gravar, então não dá para "farmar" XP)
-- Regras:
--   XP por questão = melhor nota / 10 (até 10 XP); +20 XP por módulo aprovado.
--   Ofensiva = dias seguidos (horário de Brasília) com pelo menos uma resposta,
--   contando até hoje ou ontem.
--   Trilha: o primeiro módulo fica livre; cada um seguinte abre quando o
--   anterior é aprovado.
-- =====================================================================

alter table public.edu_modules add column if not exists trail_position integer;

create or replace function public.edu_my_progress()
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_today date := (now() at time zone 'America/Sao_Paulo')::date;
  v_modules jsonb;
  v_xp_questions integer;
  v_xp_today integer;
  v_streak integer := 0;
  v_best integer := 0;
  v_run integer := 0;
  v_prev date;
  v_day date;
  v_week jsonb;
begin
  if v_uid is null then
    return null;
  end if;

  -- Melhor nota de cada questão e o dia em que ela foi alcançada.
  with best as (
    select distinct on (a.question_id)
      a.score, (a.created_at at time zone 'America/Sao_Paulo')::date as day
    from public.edu_student_answers a
    where a.student_id = v_uid
    order by a.question_id, a.score desc, a.created_at
  )
  select coalesce(sum(round(score / 10)), 0)::int,
         coalesce(sum(round(score / 10)) filter (where day = v_today), 0)::int
    into v_xp_questions, v_xp_today
  from best;

  -- Módulos da trilha com nota (última tentativa de cada questão, ponderada pelo peso).
  with mods as (
    select m.id, m.title, m.description, m.pass_score, m.trail_position, m.created_at
    from public.edu_modules m
    where m.is_published
  ),
  latest as (
    select distinct on (a.question_id) a.question_id, a.module_id, a.score
    from public.edu_student_answers a
    where a.student_id = v_uid
    order by a.question_id, a.attempt desc
  ),
  stats as (
    select q.module_id,
           count(*)::int as question_count,
           count(l.question_id)::int as answered,
           case when sum(q.points) > 0
                then round(sum(coalesce(l.score, 0) * q.points) / sum(q.points))::int
                else 0 end as score_pct
    from public.edu_questions q
    left join latest l on l.question_id = q.id
    where q.module_id in (select id from mods)
    group by q.module_id
  ),
  ordered as (
    select mo.*,
           coalesce(s.question_count, 0) as question_count,
           coalesce(s.answered, 0) as answered,
           coalesce(s.score_pct, 0) as score_pct,
           (coalesce(s.question_count, 0) > 0 and coalesce(s.score_pct, 0) >= mo.pass_score) as passed,
           row_number() over (order by mo.trail_position nulls last, mo.created_at) as step
    from mods mo
    left join stats s on s.module_id = mo.id
  ),
  with_lock as (
    select o.*,
           coalesce(bool_and(o.passed) over (order by o.step rows between unbounded preceding and 1 preceding), true)
             as unlocked
    from ordered o
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'id', id, 'title', title, 'description', description, 'step', step,
           'pass_score', pass_score, 'question_count', question_count, 'answered', answered,
           'score_pct', score_pct, 'passed', passed, 'unlocked', unlocked
         ) order by step), '[]'::jsonb)
    into v_modules
  from with_lock;

  -- Ofensiva: dias distintos com resposta.
  for v_day in
    select distinct (a.created_at at time zone 'America/Sao_Paulo')::date as d
    from public.edu_student_answers a
    where a.student_id = v_uid
    order by d
  loop
    v_run := case when v_prev = v_day - 1 then v_run + 1 else 1 end;
    v_best := greatest(v_best, v_run);
    v_prev := v_day;
  end loop;
  if v_prev is not null and v_prev >= v_today - 1 then
    v_streak := v_run;
  end if;

  -- Últimos 7 dias (para a faixa da semana).
  select jsonb_agg(jsonb_build_object('day', d, 'active', exists (
           select 1 from public.edu_student_answers a
           where a.student_id = v_uid and (a.created_at at time zone 'America/Sao_Paulo')::date = d
         )) order by d)
    into v_week
  from generate_series(v_today - 6, v_today, interval '1 day') g(dd), lateral (select dd::date as d) x;

  return jsonb_build_object(
    'xp_total', v_xp_questions + 20 * (select count(*) from jsonb_array_elements(v_modules) e where (e->>'passed')::boolean),
    'xp_today', v_xp_today,
    'streak_days', v_streak,
    'best_streak', v_best,
    'week', v_week,
    'modules', v_modules
  );
end;
$$;

revoke execute on function public.edu_my_progress() from public, anon;
grant execute on function public.edu_my_progress() to authenticated;
