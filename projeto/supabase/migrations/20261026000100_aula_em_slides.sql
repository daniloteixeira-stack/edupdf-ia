-- =====================================================================
-- Aula em slides intercalada com as questões
-- Os slides usam a mesma numeração de `position` das questões do módulo:
-- o aluno vê tudo em uma única sequência (slides, questões, slides, ...).
-- =====================================================================

create table if not exists public.edu_lesson_slides (
  id           uuid primary key default gen_random_uuid(),
  module_id    uuid not null references public.edu_modules (id) on delete cascade,
  position     integer not null default 0,
  title        text not null check (length(trim(title)) > 0),
  bullets      jsonb not null default '[]'::jsonb check (jsonb_typeof(bullets) = 'array'),
  explanation  text,
  highlight    text,
  source_page  integer,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create index if not exists edu_lesson_slides_module_idx on public.edu_lesson_slides (module_id, position);

drop trigger if exists edu_lesson_slides_touch on public.edu_lesson_slides;
create trigger edu_lesson_slides_touch before update on public.edu_lesson_slides
  for each row execute function public.edu_touch_updated_at();

alter table public.edu_lesson_slides enable row level security;

drop policy if exists lesson_slides_admin_all on public.edu_lesson_slides;
create policy lesson_slides_admin_all on public.edu_lesson_slides
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

drop policy if exists lesson_slides_student_select on public.edu_lesson_slides;
create policy lesson_slides_student_select on public.edu_lesson_slides
  for select to authenticated
  using (public.edu_can_access_module(module_id));

grant select, insert, update, delete on public.edu_lesson_slides to authenticated;
revoke all on public.edu_lesson_slides from anon;
