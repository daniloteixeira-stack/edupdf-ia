-- Específico do projeto "My Project", que já tem outro sistema com o trigger
-- private.novo_usuario. Faz esse trigger ignorar as contas do EduPDF IA.
-- Já aplicado em 2026-10-25. Não rode em um projeto Supabase só do EduPDF.
CREATE OR REPLACE FUNCTION private.novo_usuario()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  -- Contas do EduPDF IA têm perfil próprio (public.edu_profiles); não entram neste sistema.
  if coalesce(new.raw_user_meta_data->>'app', '') = 'edupdf' then
    return new;
  end if;
  insert into public.profiles (id, email, nome, ativo)
  values (new.id, coalesce(new.email, ''), coalesce(new.raw_user_meta_data->>'nome', ''),
          new.invited_at is not null or coalesce(new.raw_app_meta_data->>'origem', '') in ('chave', 'codigos'))
  on conflict (id) do nothing;
  insert into public.user_roles (user_id, role)
  values (new.id, 'vendedor')
  on conflict (user_id) do nothing;
  return new;
end;
$function$;
