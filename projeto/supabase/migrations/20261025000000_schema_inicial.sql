-- =====================================================================
-- EduPDF IA — modelagem inicial do banco (Supabase / PostgreSQL 15+)
-- Todos os objetos usam o prefixo edu_ para conviver com outros sistemas
-- no mesmo projeto Supabase.
--
-- Tabelas:  profiles, pdf_files, modules, module_students, questions,
--           question_keys, student_answers, access_logs, admin_audit
-- Enums:    app_role (admin, student), account_status, question_type,
--           pdf_status, module_audience
-- Segurança: RLS em todas as tabelas, gabaritos isolados em
--           question_keys (o aluno nunca lê a resposta certa antes de
--           responder), notas gravadas só por funções no servidor.
--
-- Como aplicar: Supabase Dashboard → SQL Editor → colar e executar,
-- ou `supabase db push` com a CLI.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------
create type public.edu_app_role        as enum ('admin', 'student');
create type public.edu_account_status  as enum ('active', 'paused', 'blocked');
create type public.edu_question_type   as enum ('multiple_choice', 'open');
create type public.edu_pdf_status      as enum ('processing', 'ready', 'error');
create type public.edu_module_audience as enum ('all', 'selected');

-- ---------------------------------------------------------------------
-- Função utilitária: updated_at automático
-- ---------------------------------------------------------------------
create or replace function public.edu_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- ---------------------------------------------------------------------
-- profiles: 1 linha por usuário do Supabase Auth
-- ---------------------------------------------------------------------
create table public.edu_profiles (
  id                    uuid primary key references auth.users (id) on delete cascade,
  email                 text not null,
  full_name             text,
  role                  public.edu_app_role       not null default 'student',
  status                public.edu_account_status not null default 'active',
  status_reason         text,
  status_changed_at     timestamptz,
  status_changed_by     uuid references auth.users (id) on delete set null,
  must_change_password  boolean not null default false,
  signup_platform       text not null default 'desktop',
  last_sign_in_at       timestamptz,
  last_sign_in_platform text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create unique index edu_profiles_email_key on public.edu_profiles (lower(email));
create index edu_profiles_role_status_idx on public.edu_profiles (role, status);
create trigger profiles_touch before update on public.edu_profiles
  for each row execute function public.edu_touch_updated_at();

-- ---------------------------------------------------------------------
-- Helpers de autorização (security definer evita recursão de RLS)
-- ---------------------------------------------------------------------
create or replace function public.edu_is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edu_profiles p
    where p.id = auth.uid() and p.role = 'admin' and p.status = 'active'
  );
$$;

create or replace function public.edu_is_active_user()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.edu_profiles p
    where p.id = auth.uid() and p.status = 'active'
  );
$$;

-- ---------------------------------------------------------------------
-- Criação automática do perfil + regra "cadastro só pelo desktop"
--
-- O app envia user_metadata.app = 'edupdf' e platform = 'desktop' no
-- signInWithOtp. O painel admin (Edge Function) usa platform 'admin_panel'.
-- Cadastro EduPDF de qualquer outra origem é recusado pelo banco.
-- Usuários sem app = 'edupdf' (outros sistemas no mesmo projeto) não ganham perfil.
-- Observação: o metadado vem do cliente; isso impede cadastro pela web
-- oficial, mas não é uma garantia criptográfica (ver docs/ARQUITETURA.md).
-- ---------------------------------------------------------------------
create or replace function public.edu_handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_app      text := coalesce(new.raw_user_meta_data ->> 'app', '');
  v_platform text := coalesce(new.raw_user_meta_data ->> 'platform', '');
begin
  -- Contas de outros sistemas no mesmo projeto Supabase são ignoradas.
  if v_app <> 'edupdf' then
    return new;
  end if;

  if v_platform not in ('desktop', 'admin_panel') then
    raise exception 'SIGNUP_DESKTOP_ONLY: o cadastro deve ser feito pelo aplicativo Windows'
      using errcode = 'P0001';
  end if;

  insert into public.edu_profiles (id, email, full_name, signup_platform)
  values (
    new.id,
    new.email,
    nullif(trim(new.raw_user_meta_data ->> 'full_name'), ''),
    v_platform
  );
  return new;
end $$;

create trigger edu_on_auth_user_created
  after insert on auth.users
  for each row execute function public.edu_handle_new_user();

-- Mantém o e-mail do perfil em sincronia com o Auth
create or replace function public.edu_handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.edu_profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger edu_on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.edu_handle_user_email_change();

-- ---------------------------------------------------------------------
-- pdf_files: PDFs enviados pelo professor (arquivo no Storage "edu-pdfs")
-- ---------------------------------------------------------------------
create table public.edu_pdf_files (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null references public.edu_profiles (id) on delete restrict,
  title           text not null check (length(trim(title)) > 0),
  original_name   text not null,
  storage_path    text not null unique,
  size_bytes      bigint not null check (size_bytes > 0),
  page_count      integer,
  extracted_text  text,
  char_count      integer generated always as (coalesce(length(extracted_text), 0)) stored,
  status          public.edu_pdf_status not null default 'processing',
  error_message   text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index edu_pdf_files_owner_idx on public.edu_pdf_files (owner_id, created_at desc);
create trigger pdf_files_touch before update on public.edu_pdf_files
  for each row execute function public.edu_touch_updated_at();

-- ---------------------------------------------------------------------
-- modules: módulo de aprendizado gerado a partir de um PDF
-- ---------------------------------------------------------------------
create table public.edu_modules (
  id               uuid primary key default gen_random_uuid(),
  title            text not null check (length(trim(title)) > 0),
  description      text,
  pdf_file_id      uuid references public.edu_pdf_files (id) on delete set null,
  created_by       uuid not null references public.edu_profiles (id) on delete restrict,
  is_published     boolean not null default false,
  audience         public.edu_module_audience not null default 'all',
  pass_score       numeric(5,2) not null default 70 check (pass_score between 0 and 100),
  max_attempts     integer not null default 3 check (max_attempts between 1 and 20),
  shuffle_options  boolean not null default true,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index edu_modules_published_idx on public.edu_modules (is_published, created_at desc);
create trigger modules_touch before update on public.edu_modules
  for each row execute function public.edu_touch_updated_at();

-- Liberação individual (quando audience = 'selected')
create table public.edu_module_students (
  module_id   uuid not null references public.edu_modules (id) on delete cascade,
  student_id  uuid not null references public.edu_profiles (id) on delete cascade,
  granted_at  timestamptz not null default now(),
  primary key (module_id, student_id)
);
create index edu_module_students_student_idx on public.edu_module_students (student_id);

create or replace function public.edu_can_access_module(p_module_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.edu_is_admin() or exists (
    select 1
    from public.edu_modules m
    where m.id = p_module_id
      and m.is_published
      and public.edu_is_active_user()
      and (
        m.audience = 'all'
        or exists (
          select 1 from public.edu_module_students ms
          where ms.module_id = m.id and ms.student_id = auth.uid()
        )
      )
  );
$$;

-- ---------------------------------------------------------------------
-- questions: o que o aluno vê (sem gabarito)
--   options = [{"id":"a1b2","text":"..."}, ...] (só múltipla escolha)
-- ---------------------------------------------------------------------
create table public.edu_questions (
  id          uuid primary key default gen_random_uuid(),
  module_id   uuid not null references public.edu_modules (id) on delete cascade,
  position    integer not null default 0,
  type        public.edu_question_type not null,
  prompt      text not null check (length(trim(prompt)) > 0),
  options     jsonb not null default '[]'::jsonb,
  points      numeric(6,2) not null default 1 check (points > 0),
  source_page integer,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint questions_options_shape check (
    jsonb_typeof(options) = 'array'
    and (
      (type = 'multiple_choice' and jsonb_array_length(options) between 2 and 8)
      or (type = 'open' and jsonb_array_length(options) = 0)
    )
  )
);
create index edu_questions_module_idx on public.edu_questions (module_id, position);
create trigger questions_touch before update on public.edu_questions
  for each row execute function public.edu_touch_updated_at();

-- ---------------------------------------------------------------------
-- question_keys: gabarito e critérios de correção (somente admin)
-- ---------------------------------------------------------------------
create table public.edu_question_keys (
  question_id        uuid primary key references public.edu_questions (id) on delete cascade,
  correct_option_id  text,          -- múltipla escolha
  explanation        text,          -- mostrado ao aluno depois de responder
  expected_answer    text,          -- questão aberta: resposta modelo
  key_points         jsonb not null default '[]'::jsonb,  -- ["ponto 1", ...]
  source_excerpt     text,          -- trecho do PDF que fundamenta a questão
  updated_at         timestamptz not null default now()
);
create trigger question_keys_touch before update on public.edu_question_keys
  for each row execute function public.edu_touch_updated_at();

-- ---------------------------------------------------------------------
-- student_answers: cada tentativa do aluno
-- ---------------------------------------------------------------------
create table public.edu_student_answers (
  id                  uuid primary key default gen_random_uuid(),
  question_id         uuid not null references public.edu_questions (id) on delete cascade,
  module_id           uuid not null references public.edu_modules (id) on delete cascade,
  student_id          uuid not null references public.edu_profiles (id) on delete cascade,
  attempt             integer not null check (attempt >= 1),
  selected_option_id  text,
  answer_text         text check (answer_text is null or length(answer_text) <= 8000),
  score               numeric(5,2) not null check (score between 0 and 100),
  is_correct          boolean not null,
  feedback            text,
  feedback_details    jsonb not null default '{}'::jsonb,
  graded_by           text not null check (graded_by in ('auto', 'ai')),
  ai_model            text,
  created_at          timestamptz not null default now(),
  unique (question_id, student_id, attempt)
);
create index edu_student_answers_student_idx on public.edu_student_answers (student_id, module_id, created_at desc);
create index edu_student_answers_module_idx  on public.edu_student_answers (module_id, created_at desc);

-- ---------------------------------------------------------------------
-- access_logs: entradas/saídas e tentativas bloqueadas
-- ---------------------------------------------------------------------
create table public.edu_access_logs (
  id          bigint generated always as identity primary key,
  user_id     uuid references public.edu_profiles (id) on delete cascade,
  event       text not null check (event in ('sign_in', 'sign_out', 'signup', 'password_changed', 'blocked_attempt')),
  platform    text not null check (platform in ('desktop', 'web')),
  user_agent  text,
  created_at  timestamptz not null default now()
);
create index edu_access_logs_user_idx on public.edu_access_logs (user_id, created_at desc);
create index edu_access_logs_created_idx on public.edu_access_logs (created_at desc);

-- ---------------------------------------------------------------------
-- admin_audit: trilha de auditoria das ações administrativas
-- ---------------------------------------------------------------------
create table public.edu_admin_audit (
  id              bigint generated always as identity primary key,
  admin_id        uuid references public.edu_profiles (id) on delete set null,
  target_user_id  uuid references public.edu_profiles (id) on delete set null,
  action          text not null,
  details         jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now()
);
create index edu_admin_audit_target_idx on public.edu_admin_audit (target_user_id, created_at desc);

-- =====================================================================
-- RPCs chamadas pelo cliente
-- =====================================================================

-- Registra um evento de acesso e devolve o status atual do perfil.
create or replace function public.edu_log_access(
  p_event text,
  p_platform text,
  p_user_agent text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.edu_profiles;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;
  if p_event not in ('sign_in', 'sign_out', 'signup', 'password_changed') then
    raise exception 'INVALID_EVENT';
  end if;
  if p_platform not in ('desktop', 'web') then
    raise exception 'INVALID_PLATFORM';
  end if;

  select * into v_profile from public.edu_profiles where id = auth.uid();
  if not found then
    raise exception 'PROFILE_NOT_FOUND';
  end if;

  insert into public.edu_access_logs (user_id, event, platform, user_agent)
  values (
    auth.uid(),
    case when v_profile.status <> 'active' then 'blocked_attempt' else p_event end,
    p_platform,
    left(p_user_agent, 400)
  );

  if p_event = 'sign_in' and v_profile.status = 'active' then
    update public.edu_profiles
       set last_sign_in_at = now(), last_sign_in_platform = p_platform
     where id = auth.uid();
  end if;

  if p_event = 'password_changed' then
    update public.edu_profiles set must_change_password = false where id = auth.uid();
  end if;

  return jsonb_build_object(
    'status', v_profile.status,
    'role', v_profile.role,
    'must_change_password', v_profile.must_change_password and p_event <> 'password_changed'
  );
end $$;

-- Corrige uma questão de múltipla escolha no servidor e grava a tentativa.
create or replace function public.edu_submit_mc_answer(
  p_question_id uuid,
  p_option_id text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_q        public.edu_questions;
  v_key      public.edu_question_keys;
  v_module   public.edu_modules;
  v_attempt  integer;
  v_correct  boolean;
begin
  if auth.uid() is null then
    raise exception 'NOT_AUTHENTICATED' using errcode = '28000';
  end if;

  select * into v_q from public.edu_questions where id = p_question_id;
  if not found or v_q.type <> 'multiple_choice' then
    raise exception 'QUESTION_NOT_FOUND';
  end if;
  if not public.edu_can_access_module(v_q.module_id) then
    raise exception 'MODULE_FORBIDDEN' using errcode = '42501';
  end if;
  if not exists (
    select 1 from jsonb_array_elements(v_q.options) o where o ->> 'id' = p_option_id
  ) then
    raise exception 'INVALID_OPTION';
  end if;

  select * into v_module from public.edu_modules where id = v_q.module_id;
  select * into v_key from public.edu_question_keys where question_id = p_question_id;

  -- trava por aluno+questão para numerar tentativas sem corrida
  perform pg_advisory_xact_lock(hashtextextended(auth.uid()::text || p_question_id::text, 0));
  select coalesce(max(attempt), 0) + 1 into v_attempt
    from public.edu_student_answers
   where question_id = p_question_id and student_id = auth.uid();

  if v_attempt > v_module.max_attempts and not public.edu_is_admin() then
    raise exception 'MAX_ATTEMPTS_REACHED';
  end if;

  v_correct := v_key.correct_option_id is not null and v_key.correct_option_id = p_option_id;

  insert into public.edu_student_answers (
    question_id, module_id, student_id, attempt, selected_option_id,
    score, is_correct, feedback, graded_by
  ) values (
    p_question_id, v_q.module_id, auth.uid(), v_attempt, p_option_id,
    case when v_correct then 100 else 0 end, v_correct, v_key.explanation, 'auto'
  );

  return jsonb_build_object(
    'is_correct', v_correct,
    'score', case when v_correct then 100 else 0 end,
    'correct_option_id', v_key.correct_option_id,
    'explanation', v_key.explanation,
    'attempt', v_attempt,
    'attempts_left', greatest(v_module.max_attempts - v_attempt, 0)
  );
end $$;

-- Resumo do aluno logado num módulo (última tentativa de cada questão).
create or replace function public.edu_my_module_summary(p_module_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with latest as (
    select distinct on (sa.question_id) sa.question_id, sa.score, sa.attempt
      from public.edu_student_answers sa
     where sa.module_id = p_module_id and sa.student_id = auth.uid()
     order by sa.question_id, sa.attempt desc
  ), totals as (
    select count(*)::int as total, coalesce(sum(q.points), 0) as total_points
      from public.edu_questions q where q.module_id = p_module_id
  )
  select jsonb_build_object(
    'total_questions', t.total,
    'answered', (select count(*) from latest),
    'score_percent', case when t.total_points = 0 then 0 else round(
      (select coalesce(sum(l.score * q.points), 0)
         from latest l join public.edu_questions q on q.id = l.question_id) / t.total_points, 2) end,
    'pass_score', (select m.pass_score from public.edu_modules m where m.id = p_module_id)
  )
  from totals t
  where public.edu_can_access_module(p_module_id);
$$;

-- Revoga todas as sessões (refresh tokens) de um usuário.
-- Só a Edge Function admin-users (service role) pode chamar.
create or replace function public.edu_admin_revoke_sessions(p_user_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  delete from auth.sessions where user_id = p_user_id;
  delete from auth.refresh_tokens where user_id = p_user_id::text;
end $$;

revoke all on function public.edu_admin_revoke_sessions(uuid) from public, anon, authenticated;
grant execute on function public.edu_admin_revoke_sessions(uuid) to service_role;

revoke all on function public.edu_log_access(text, text, text) from public, anon;
grant execute on function public.edu_log_access(text, text, text) to authenticated;
revoke all on function public.edu_submit_mc_answer(uuid, text) from public, anon;
grant execute on function public.edu_submit_mc_answer(uuid, text) to authenticated;
revoke all on function public.edu_my_module_summary(uuid) from public, anon;
grant execute on function public.edu_my_module_summary(uuid) to authenticated;

-- =====================================================================
-- Row Level Security
-- =====================================================================
alter table public.edu_profiles        enable row level security;
alter table public.edu_pdf_files       enable row level security;
alter table public.edu_modules         enable row level security;
alter table public.edu_module_students enable row level security;
alter table public.edu_questions       enable row level security;
alter table public.edu_question_keys   enable row level security;
alter table public.edu_student_answers enable row level security;
alter table public.edu_access_logs     enable row level security;
alter table public.edu_admin_audit     enable row level security;

-- profiles ------------------------------------------------------------
create policy profiles_select_self_or_admin on public.edu_profiles
  for select to authenticated
  using (id = auth.uid() or public.edu_is_admin());

-- o próprio usuário só altera o nome (coluna liberada por GRANT abaixo);
-- papel, status e senha mudam apenas pela Edge Function admin-users.
create policy profiles_update_self on public.edu_profiles
  for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

revoke insert, update, delete on public.edu_profiles from anon, authenticated;
grant select on public.edu_profiles to authenticated;
grant update (full_name) on public.edu_profiles to authenticated;

-- pdf_files -----------------------------------------------------------
create policy pdf_files_admin_all on public.edu_pdf_files
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

-- modules -------------------------------------------------------------
create policy modules_admin_all on public.edu_modules
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

create policy modules_student_select on public.edu_modules
  for select to authenticated
  using (public.edu_can_access_module(id));

-- module_students -----------------------------------------------------
create policy module_students_admin_all on public.edu_module_students
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

create policy module_students_self_select on public.edu_module_students
  for select to authenticated
  using (student_id = auth.uid());

-- questions -----------------------------------------------------------
create policy questions_admin_all on public.edu_questions
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

create policy questions_student_select on public.edu_questions
  for select to authenticated
  using (public.edu_can_access_module(module_id));

-- question_keys (gabarito) --------------------------------------------
create policy question_keys_admin_all on public.edu_question_keys
  for all to authenticated
  using (public.edu_is_admin()) with check (public.edu_is_admin());

-- student_answers -----------------------------------------------------
-- Sem política de INSERT/UPDATE: notas só entram por submit_mc_answer()
-- ou pela Edge Function grade-open-answer (service role).
create policy student_answers_select on public.edu_student_answers
  for select to authenticated
  using (student_id = auth.uid() or public.edu_is_admin());

create policy student_answers_admin_delete on public.edu_student_answers
  for delete to authenticated
  using (public.edu_is_admin());

-- access_logs ---------------------------------------------------------
create policy access_logs_select on public.edu_access_logs
  for select to authenticated
  using (user_id = auth.uid() or public.edu_is_admin());

-- admin_audit ---------------------------------------------------------
create policy admin_audit_admin_select on public.edu_admin_audit
  for select to authenticated
  using (public.edu_is_admin());

-- anon não lê nada
revoke all on public.edu_profiles, public.edu_pdf_files, public.edu_modules,
  public.edu_module_students, public.edu_questions, public.edu_question_keys,
  public.edu_student_answers, public.edu_access_logs, public.edu_admin_audit
  from anon;

-- =====================================================================
-- Storage: bucket privado "edu-pdfs" (limite 50 MB, só PDF)
-- Sem políticas para usuários: upload e leitura passam pela Edge Function
-- edu-pdf-storage (URLs assinadas, só para admin).
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('edu-pdfs', 'edu-pdfs', false, 52428800, array['application/pdf'])
on conflict (id) do update
  set public = excluded.public,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- =====================================================================
-- Realtime: painel do admin acompanha perfis e acessos ao vivo
-- =====================================================================
alter publication supabase_realtime add table public.edu_profiles;
alter publication supabase_realtime add table public.edu_access_logs;

-- =====================================================================
-- Primeiro administrador (rode UMA vez, depois de se cadastrar no app):
--   update public.edu_profiles set role = 'admin' where lower(email) = lower('seu@email.com');
-- =====================================================================

-- =====================================================================
-- Endurecimento (alertas do Security Advisor do Supabase)
-- =====================================================================
alter function public.edu_touch_updated_at() set search_path = '';
revoke execute on function public.edu_handle_new_user() from public, anon, authenticated;
revoke execute on function public.edu_handle_user_email_change() from public, anon, authenticated;
revoke execute on function public.edu_touch_updated_at() from public, anon, authenticated;
revoke execute on function public.edu_is_admin() from public, anon;
revoke execute on function public.edu_is_active_user() from public, anon;
revoke execute on function public.edu_can_access_module(uuid) from public, anon;
revoke execute on function public.edu_log_access(text, text, text) from public, anon;
revoke execute on function public.edu_my_module_summary(uuid) from public, anon;
revoke execute on function public.edu_submit_mc_answer(uuid, text) from public, anon;
grant execute on function public.edu_is_admin(), public.edu_is_active_user(), public.edu_can_access_module(uuid),
  public.edu_log_access(text, text, text), public.edu_my_module_summary(uuid), public.edu_submit_mc_answer(uuid, text) to authenticated;
