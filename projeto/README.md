# EduPDF IA

Plataforma para professores transformarem PDFs em módulos de estudo com questões geradas e corrigidas por IA.

- **Web** (painel do professor e acesso do aluno) hospedada na **Vercel**.
- **App Windows (.exe)** com a mesma interface, empacotado com **Tauri**. O cadastro de novos alunos só acontece por ele.
- **Supabase** cuida do banco (PostgreSQL com RLS), do login (e-mail + código OTP de 6 dígitos + senha), do armazenamento dos PDFs e das Edge Functions.
- **IA:** Anthropic API (Claude). O modelo pode ser trocado pela variável `AI_MODEL`.

Este projeto é independente do app de idiomas da pasta `Project 01`.

## O que tem

| Perfil | Funcionalidades |
|---|---|
| Professor / Admin | Upload de PDF com extração de texto · geração de questões (múltipla escolha e abertas) por intervalo de páginas · edição manual das questões e do gabarito · publicação para todos ou para alunos escolhidos · notas por aluno · painel de usuários em tempo real (pausar, cancelar acesso, reativar, redefinir senha, promover a admin, criar aluno) · histórico de acessos |
| Aluno | Lista de módulos liberados com progresso · múltipla escolha com alternativas embaralhadas (animação suave), atalhos de teclado e correção na hora · questão aberta com editor estruturado e correção por IA: porcentagem de 0 a 100%, veredito, o que acertou, o que faltou e o que está errado · nota final do módulo |

## Estrutura

```
EduPDF-IA/
├── supabase/
│   ├── migrations/20261025000000_schema_inicial.sql   tabelas edu_*, enums, RLS, storage, RPCs
│   ├── migrations/20261025000100_ajuste_novo_usuario_my_project.sql  só para o My Project
│   ├── functions/
│   │   ├── _shared/                auth, CORS, cliente da IA (prompts e esquemas)
│   │   ├── edu-generate-questions/ gera questões a partir do PDF (só admin)
│   │   ├── edu-grade-open-answer/  corrige resposta aberta (0–100%) e grava a nota
│   │   ├── edu-admin-users/        pausar, bloquear, reativar, senha, papel, criar aluno
│   │   └── edu-pdf-storage/        upload e visualização dos PDFs por URL assinada
│   ├── templates/              e-mails com o código de 6 dígitos
│   └── config.toml
├── web/                        React + Vite + TypeScript (web e desktop)
│   ├── src/
│   │   ├── auth/               sessão, perfil e logout em tempo real
│   │   ├── pages/              login, cadastro OTP, recuperar senha, trocar senha
│   │   ├── student/            lista de módulos, player, MultipleChoice, OpenQuestion
│   │   ├── admin/              usuários, PDFs, módulos, editor de questões, resultados
│   │   ├── components/         OtpInput, ScoreRing, Modal, campos de senha
│   │   └── lib/                cliente Supabase, chamadas de API, extração de PDF
│   ├── src-tauri/              configuração do .exe (Tauri 2, instalador NSIS)
│   ├── vercel.json
│   └── .env.example
└── docs/
    ├── GUIA_INSTALACAO.md      passo a passo: Supabase, Vercel e build do .exe
    └── ARQUITETURA.md          modelo de dados, segurança e decisões
```

Comece pelo [guia de instalação](docs/GUIA_INSTALACAO.md).

## O que foi verificado

- O script SQL foi aplicado num PostgreSQL 16 com um esquema `auth`/`storage` simulado, e as regras foram testadas: cadastro fora do desktop recusado; aluno não lê gabaritos, PDFs nem outros perfis; aluno não consegue gravar a própria nota nem mudar o próprio papel; limite de tentativas; aluno pausado perde acesso aos módulos.
- As quatro Edge Functions passam no `deno check` e no `deno lint`.
- A interface compila (`tsc` + `vite build`, modos web e desktop) e foi exercitada no Chromium com o Supabase simulado: cadastro por OTP, múltipla escolha por teclado com embaralhamento, questão aberta com nota, resultado final, painel de usuários e editor de módulos.
- O app Tauri compila em modo release (testado no Linux; no Windows o comando gera o instalador `.exe`).

Instalado em 2026-10-25 no projeto Supabase "My Project" (ref `nlcylhhyesdbpjgzpdad`), junto com o sistema que já existia lá. Por isso tudo do EduPDF tem o prefixo `edu_`. A correção por IA ainda depende de você cadastrar a `ANTHROPIC_API_KEY` nos secrets.
