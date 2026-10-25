# Arquitetura e segurança

## Visão geral

```
 App Windows (.exe, Tauri) ──┐
                             ├──► Supabase Auth (e-mail + OTP + senha)
 Web (Vercel, React/Vite) ───┤    PostgreSQL com RLS ◄── Realtime (perfis, acessos)
                             │    Storage (bucket privado "edu-pdfs")
                             └──► Edge Functions ──► Anthropic API (Claude)
                                    edu-generate-questions · edu-grade-open-answer · edu-admin-users · edu-pdf-storage
```

Uma única base de código React serve web e desktop. `VITE_PLATFORM=desktop` (arquivo `.env.desktop`) liga o fluxo de cadastro e o roteamento por hash usado dentro do `.exe`.

Escolhi **Tauri** em vez de Electron: instalador de ~5–10 MB em vez de ~80 MB, usa o WebView2 que já vem no Windows e reaproveita as ferramentas (Rust, C++ Build Tools) que você já usa no app de idiomas. O código do app de idiomas não foi tocado.

## Modelo de dados

Tudo do EduPDF usa o prefixo `edu_` (tabelas, funções, tipos) porque ele está instalado no mesmo projeto Supabase de outro sistema, o "My Project". O trigger de cadastro do EduPDF só age em contas com `app = "edupdf"` nos metadados, e o trigger do outro sistema (`private.novo_usuario`) foi ajustado para ignorar essas contas. Os dois sistemas compartilham o Supabase Auth: o mesmo e-mail não pode ter conta nos dois.

Os PDFs ficam no bucket privado `edu-pdfs`, sem políticas de acesso direto: o upload e a visualização passam pela função `edu-pdf-storage`, que confere se é professor e devolve uma URL assinada.

| Tabela | Conteúdo | Quem lê | Quem escreve |
|---|---|---|---|
| `edu_profiles` | e-mail, nome, `role` (admin/student), `status` (active/paused/blocked), último acesso | o próprio usuário; admin vê todos | trigger de cadastro; usuário só muda o nome; o resto só pela função `edu-admin-users` |
| `edu_pdf_files` | metadados + texto extraído com marcadores `[[página N]]` | admin | admin |
| `edu_modules` | título, PDF de referência, nota mínima, tentativas, embaralhar, público | admin; aluno vê os publicados e liberados para ele | admin |
| `edu_module_students` | liberação individual quando o público é "selecionados" | admin; aluno vê as próprias | admin |
| `edu_questions` | enunciado, tipo, alternativas `[{id, text}]`, peso | admin; aluno dos módulos liberados | admin, `edu-generate-questions` |
| `edu_question_keys` | gabarito, explicação, resposta modelo, pontos-chave, trecho do PDF | **só admin** | admin, `edu-generate-questions` |
| `edu_student_answers` | cada tentativa: resposta, nota 0–100, feedback | o próprio aluno; admin | **só** `edu_submit_mc_answer()` e `edu-grade-open-answer` |
| `edu_access_logs` | entrada, saída, cadastro, troca de senha, tentativa bloqueada | o próprio usuário; admin | RPC `edu_log_access()` |
| `edu_admin_audit` | quem pausou/bloqueou/redefiniu quem, e por quê | admin | `edu-admin-users` |

## Decisões de segurança

- **Gabarito separado.** RLS filtra linhas, não colunas. Por isso o gabarito mora em `edu_question_keys`, que o aluno não consegue ler. A múltipla escolha é corrigida no banco por `edu_submit_mc_answer()`, que só devolve a alternativa certa depois que o aluno respondeu.
- **Nota não pode ser forjada.** Não existe política de INSERT em `edu_student_answers`. As notas entram só pela função SQL (múltipla escolha) e pela Edge Function com service role (questão aberta). O limite de tentativas é aplicado no servidor.
- **Pausar e cancelar valem na hora.** A função `edu-admin-users` bane o usuário no Supabase Auth, apaga as sessões e refresh tokens (`edu_admin_revoke_sessions`, executável só pela service role) e muda o `status`. As políticas RLS exigem `status = 'active'`, então mesmo um token ainda válido para de ver conteúdo. O app do aluno escuta o próprio perfil por Realtime e sai sozinho.
- **Redefinir senha** tem dois caminhos: enviar um código de recuperação por e-mail ou definir uma senha temporária, que obriga a troca no próximo login (`must_change_password`).
- **Proteções no painel:** o admin não pode bloquear a si mesmo nem rebaixar o último admin ativo. Toda ação fica em `edu_admin_audit`.
- **Chaves.** A service role e a chave da Anthropic existem só como secrets das Edge Functions. O app recebe apenas a URL e a chave pública (publishable/anon), que é feita para ficar no cliente; quem protege os dados é o RLS.
- **Prompt injection.** A resposta do aluno vai delimitada em `<resposta_do_aluno>` com instrução explícita para ignorar ordens dentro dela; o PDF é tratado como material de referência, não como instrução. A saída da IA é validada por esquema (structured outputs com Zod) e a nota é limitada a 0–100 no servidor.

### Limite honesto: "cadastro só pelo desktop"

O app desktop envia `platform: "desktop"` ao pedir o código, e um trigger no banco recusa cadastros sem essa marca. Isso impede o cadastro pela web oficial e por qualquer cliente que não saiba da regra. Mas a marca vem do cliente: alguém técnico que extraia a chave pública do `.exe` consegue imitar a chamada. Não existe garantia criptográfica de "este pedido veio do meu `.exe`" sem assinatura de hardware ou atestado do sistema operacional. Para quem precisa de controle total, duas opções:

1. **Convite/whitelist:** adicionar uma tabela de e-mails autorizados (ou domínio da escola) e checar no mesmo trigger. Recomendo isso se a turma for fechada.
2. **Aprovação manual:** criar novos perfis já como `paused` e o professor libera no painel.

As duas são mudanças pequenas no trigger `edu_handle_new_user`.

## IA

- **Geração** (`edu-generate-questions`): recebe o texto do PDF (inteiro ou um intervalo de páginas), pede N questões de múltipla escolha e M abertas com dificuldade e orientações do professor, e recebe JSON validado: enunciado, alternativas, índice correto, explicação, resposta modelo, 3–6 pontos-chave, trecho do PDF e página. Questões malformadas são descartadas.
- **Correção** (`edu-grade-open-answer`): compara a resposta com o material, a resposta modelo e os pontos-chave. A nota é distribuída pelos pontos-chave, avalia significado (não palavras exatas) e desconta afirmações que contradizem o material. Retorna porcentagem, veredito (correta ≥ 80, parcial 40–79, incorreta < 40), feedback e as listas do que acertou, faltou e errou. A resposta conta como "acerto" a partir de 60%.
- **Provedor:** Anthropic (padrão) ou Google Gemini (plano gratuito), escolhido pela chave cadastrada ou por `AI_PROVIDER`. No Gemini a saída também é validada pelo mesmo esquema Zod.
- **Modelo:** `AI_MODEL` (padrão `claude-opus-5-5`, ou `gemini-flash-latest` no Gemini), esforço configurável por `AI_GENERATION_EFFORT` e `AI_GRADING_EFFORT`. Pensamento adaptativo ligado.
- **PDFs grandes:** a geração recusa trechos acima de `AI_MAX_SOURCE_CHARS` (padrão 600 mil caracteres) pedindo um intervalo de páginas menor, em vez de cortar o texto em silêncio. A correção usa recuperação simples por termos quando o PDF passa de 250 mil caracteres. Se no futuro houver muitos PDFs grandes, o próximo passo é indexar com `pgvector` e busca semântica.
- **Extração de texto** é feita no navegador/app com pdf.js, página por página, antes do upload. PDFs escaneados (sem texto) são marcados como "Sem texto" e pedem OCR.

## Interface do aluno

- **Múltipla escolha:** alternativas embaralhadas por aluno e a cada nova tentativa, com animação FLIP (as opções deslizam até a nova posição) e respeito a "reduzir movimento" do Windows. Teclado: A–H ou 1–8 escolhe, ↑/↓ navega, Enter confirma e avança, S embaralha. Clique duplo também confirma. Correta fica verde com um leve "pop"; errada vermelha com um "tremor".
- **Aberta:** editor com contador de palavras, estrutura sugerida (ideia principal / explicação / exemplo), Ctrl+Enter envia; resultado com anel de porcentagem animado.
- **Nota do módulo:** média ponderada pelo peso das questões, usando a última tentativa de cada questão, comparada com a nota mínima do módulo.
