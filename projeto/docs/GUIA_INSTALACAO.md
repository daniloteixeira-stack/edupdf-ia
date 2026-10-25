# Guia de instalação, deploy e build do .exe

O EduPDF IA está instalado no projeto Supabase **My Project** (ref `nlcylhhyesdbpjgzpdad`), que também tem outro sistema. Tudo do EduPDF usa o prefixo `edu_`, então os dois não se misturam.

| Passo | Situação |
|---|---|
| 1. Banco (tabelas, RLS, bucket `edu-pdfs`, Realtime) | Feito em 2026-10-25 |
| 2. Ajuste no cadastro do outro sistema (`private.novo_usuario`) | Feito em 2026-10-25 |
| 3. Edge Functions | Feito (falta a chave da IA, passo 3.1) |
| 4. E-mail com código de 6 dígitos | **Você** |
| 5. Web na Vercel | Depende do repositório no GitHub |
| 6. Instalador Windows (.exe) | Gerado pelo GitHub Actions |
| 7. Primeiro administrador | Depois do primeiro cadastro |

Valores públicos (podem ir no app):

- URL: `https://nlcylhhyesdbpjgzpdad.supabase.co`
- Chave publishable: em Supabase → Project Settings → API Keys

Segredos (nunca no código nem no Git): a service role key e a chave da Anthropic.

---

## 1–2. Banco

Já aplicados. Para outro projeto Supabase, rode no SQL Editor só `supabase/migrations/20261025000000_schema_inicial.sql`. O arquivo `20261025000100_ajuste_novo_usuario_my_project.sql` é exclusivo do My Project.

## 3. Edge Functions e IA

Publicadas: `edu-generate-questions`, `edu-grade-open-answer`, `edu-admin-users` e `edu-pdf-storage`.

### 3.1 Chave da IA (obrigatório)

No Supabase: **Edge Functions → Secrets → Add new secret**:

| Nome | Valor |
|---|---|
| `GEMINI_API_KEY` | chave gratuita de aistudio.google.com/apikey **ou** `ANTHROPIC_API_KEY` (paga, console.anthropic.com) |
| `ALLOWED_ORIGINS` | a URL da Vercel, ex.: `https://edupdf-ia.vercel.app` |

O sistema usa a IA que tiver chave (se tiver as duas, usa a Anthropic; force com `AI_PROVIDER=gemini` ou `anthropic`). No plano gratuito do Gemini há limite de pedidos por minuto, e o Google pode usar o conteúdo enviado para melhorar os produtos dele.

Opcionais: `AI_MODEL` (padrão `claude-opus-5-5` na Anthropic e `gemini-flash-latest` no Gemini; `claude-sonnet-5-5` custa cerca de metade), `AI_GENERATION_EFFORT` e `AI_GRADING_EFFORT` (`low`, `medium` ou `high`; padrão `medium`).

Os secrets valem na hora, sem republicar as funções.

Sobre custo e tempo:
- A correção de questões abertas envia o PDF inteiro quando ele tem até 250 mil caracteres, com cache: a partir do segundo aluno no mesmo módulo a leitura sai bem mais barata. Acima disso, só os trechos mais relacionados.
- As Edge Functions têm limite de 150 s no plano Free. Gere no máximo umas 10 questões por vez.

## 4. E-mail com código de 6 dígitos

**Atenção:** os modelos de e-mail e o SMTP são do projeto inteiro, ou seja, valem também para o outro sistema do My Project. Antes de trocar, confira se o outro sistema usa link ou código no e-mail.

1. **Authentication → Sign In / Providers → Email**: Confirm email ligado, **Email OTP Length = 6**, **Email OTP Expiration = 600**.
2. **Authentication → Email Templates**: nos modelos **Confirm signup** e **Reset Password**, o corpo precisa ter `{{ .Token }}` (o código). Modelos prontos em `supabase/templates/`. Se o outro sistema precisa do link, deixe os dois: o código e o `{{ .ConfirmationURL }}`.
3. **Authentication → SMTP Settings**: configure um SMTP próprio (Resend, Brevo…). O embutido envia poucas mensagens por hora.
4. **Authentication → URL Configuration**: adicione a URL da Vercel e `http://tauri.localhost` em **Redirect URLs** (não troque a Site URL do outro sistema).

## 5. Web na Vercel

1. Em vercel.com: **Add New → Project**, importe o repositório `edupdf-ia` e defina **Root Directory = `web`**.
2. Em **Environment Variables**: `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` (valores públicos acima).
3. **Deploy**. Depois coloque a URL final em `ALLOWED_ORIGINS` (passo 3.1) e nas Redirect URLs (passo 4.4).

Rodar localmente: `cd web`, copie `.env.example` para `.env.local`, preencha, `npm install` e `npm run dev`.

## 6. Instalador Windows (.exe)

### Pelo GitHub (recomendado)

O arquivo `.github/workflows/windows-exe.yml` gera o instalador numa máquina Windows do GitHub a cada push na `main`.

1. No repositório: **Settings → Secrets and variables → Actions → Variables**, crie `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`.
2. **Actions → Instalador Windows → Run workflow** (ou faça um push).
3. Ao terminar (uns 10 minutos), baixe em **Artifacts → EduPDF-IA-Windows**.

### No seu PC

Ferramentas (as mesmas do app de idiomas): Microsoft C++ Build Tools, Rust (rustup.rs) e Node.js 22. Em `web`:

```powershell
copy .env.example .env.local
notepad .env.local        # VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY
npm install
npm run desktop:build
```

O instalador sai em `web\src-tauri\target\release\bundle\nsis\EduPDF IA_1.0.0_x64-setup.exe`. Instala por usuário, sem pedir administrador.

- A URL e a chave pública ficam embutidas no `.exe`. Se trocar de projeto Supabase, gere de novo.
- O SmartScreen pode avisar "editor desconhecido" porque o instalador não é assinado.

## 7. Primeiro administrador

1. Abra o `.exe`, clique em **Criar conta**, informe seu e-mail, digite o código e crie a senha. Use um e-mail que **não** tenha conta no outro sistema do My Project.
2. No SQL Editor:

```sql
update public.edu_profiles set role = 'admin' where lower(email) = lower('seu@email.com');
```

3. Saia e entre de novo. Aparecem **Usuários, PDFs e Módulos**.

## Teste final (10 minutos)

1. **PDFs**: envie um PDF com texto. Deve aparecer com o número de caracteres.
2. **Módulos**: crie um módulo com o PDF, gere 3 de múltipla escolha e 1 aberta, revise e **Publique**.
3. No `.exe`, crie uma conta de aluno com outro e-mail e faça o módulo (teclas A–D, **S** embaralha, **Enter** confirma; na aberta, confira a porcentagem e o feedback).
4. Em **Usuários**, pause o aluno: o app dele sai sozinho em segundos. Reative.
5. **Ações → Redefinir senha → senha temporária**: no próximo login o aluno é obrigado a trocar.
6. Na web, abra `/cadastro`: deve avisar que o cadastro é só pelo app Windows.

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| E-mail chega com link em vez de código | Modelo sem `{{ .Token }}` (passo 4.2) |
| "Muitas tentativas" ao pedir o código | SMTP embutido; configure SMTP próprio |
| "Este e-mail já está ligado a outra conta" | O e-mail já tem conta no outro sistema do My Project |
| Erro de CORS ao gerar/corrigir | URL da Vercel ausente em `ALLOWED_ORIGINS` |
| "Chave da IA não configurada" | Nenhum secret `GEMINI_API_KEY` ou `ANTHROPIC_API_KEY` (passo 3.1) |
| "Chave da IA inválida" | A chave foi salva com o nome do outro provedor ou foi excluída |
| "Limite gratuito da IA atingido" | Plano gratuito do Gemini; espere um minuto |
| "PDF sem texto" | PDF escaneado; passe por OCR e envie de novo |
| Tempo esgotado ao gerar | Muitas questões por vez ou intervalo de páginas grande |
