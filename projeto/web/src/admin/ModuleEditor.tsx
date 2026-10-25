import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import { generateQuestions } from "../lib/api";
import type { Module, PdfFile, Profile, Question, QuestionKey, QuestionType } from "../lib/types";
import { QuestionEditor } from "./QuestionEditor";
import { ModuleResults } from "./ModuleResults";
import { Modal } from "../components/Modal";

type Tab = "questions" | "settings" | "results";

export function ModuleEditor() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>("questions");
  const [mod, setMod] = useState<Module | null>(null);
  const [pdfs, setPdfs] = useState<Pick<PdfFile, "id" | "title" | "page_count">[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [keys, setKeys] = useState<Map<string, QuestionKey>>(new Map());
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    const [m, p, q] = await Promise.all([
      supabase.from("edu_modules").select("*").eq("id", id).single(),
      supabase.from("edu_pdf_files").select("id, title, page_count").eq("status", "ready"),
      supabase.from("edu_questions").select("*, question_keys:edu_question_keys(*)").eq("module_id", id).order("position"),
    ]);
    if (m.error) return setError(friendlyError(m.error));
    setMod(m.data as Module);
    setPdfs(p.data ?? []);
    const qs = (q.data ?? []) as Array<Question & { question_keys: QuestionKey | QuestionKey[] | null }>;
    setQuestions(qs);
    setKeys(new Map(qs.map((x) => [x.id, (Array.isArray(x.question_keys) ? x.question_keys[0] : x.question_keys) as QuestionKey])));
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (error && !mod) return <div className="alert alert-error">{error}</div>;
  if (!mod) return <div className="loading">Carregando…</div>;

  const togglePublish = async () => {
    if (!mod.is_published && questions.length === 0) return setError("Adicione questões antes de publicar.");
    const { error } = await supabase.from("edu_modules").update({ is_published: !mod.is_published }).eq("id", mod.id);
    if (error) return setError(friendlyError(error));
    setInfo(mod.is_published ? "Módulo voltou para rascunho." : "Módulo publicado para os alunos.");
    void load();
  };

  return (
    <div className="page">
      <header className="page-head row between wrap">
        <div>
          <Link to="/admin/modulos" className="btn-link">
            ← Módulos
          </Link>
          <h1>{mod.title}</h1>
          <span className={`status ${mod.is_published ? "status-active" : "status-paused"}`}>{mod.is_published ? "Publicado" : "Rascunho"}</span>
        </div>
        <button className={`btn ${mod.is_published ? "btn-ghost" : "btn-primary"}`} onClick={() => void togglePublish()}>
          {mod.is_published ? "Despublicar" : "Publicar para alunos"}
        </button>
      </header>

      <nav className="tabs">
        {(
          [
            ["questions", `Questões (${questions.length})`],
            ["settings", "Configurações"],
            ["results", "Resultados"],
          ] as Array<[Tab, string]>
        ).map(([t, label]) => (
          <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
            {label}
          </button>
        ))}
      </nav>

      {info && <div className="alert alert-success">{info}</div>}
      {error && <div className="alert alert-error">{error}</div>}

      {tab === "questions" && (
        <QuestionsTab
          mod={mod}
          pdf={pdfs.find((p) => p.id === mod.pdf_file_id) ?? null}
          questions={questions}
          keys={keys}
          reload={load}
          setError={setError}
          setInfo={setInfo}
        />
      )}
      {tab === "settings" && (
        <SettingsTab
          mod={mod}
          pdfs={pdfs}
          onSaved={() => {
            setInfo("Configurações salvas.");
            void load();
          }}
          onDeleted={() => navigate("/admin/modulos")}
          setError={setError}
        />
      )}
      {tab === "results" && <ModuleResults module={mod} questions={questions} />}
    </div>
  );
}

// ---------------------------------------------------------------------------

function QuestionsTab(props: {
  mod: Module;
  pdf: Pick<PdfFile, "id" | "title" | "page_count"> | null;
  questions: Question[];
  keys: Map<string, QuestionKey>;
  reload: () => Promise<void>;
  setError: (e: string | null) => void;
  setInfo: (e: string | null) => void;
}) {
  const { mod, pdf, questions, keys, reload, setError, setInfo } = props;
  const [mc, setMc] = useState(5);
  const [open, setOpen] = useState(2);
  const [difficulty, setDifficulty] = useState<"facil" | "medio" | "dificil">("medio");
  const [pageFrom, setPageFrom] = useState("");
  const [pageTo, setPageTo] = useState("");
  const [instructions, setInstructions] = useState("");
  const [generating, setGenerating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState<QuestionType | null>(null);
  const [toDelete, setToDelete] = useState<Question | null>(null);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    setInfo(null);
    try {
      const res = await generateQuestions({
        module_id: mod.id,
        multiple_choice: mc,
        open,
        difficulty,
        page_from: pageFrom ? Number(pageFrom) : null,
        page_to: pageTo ? Number(pageTo) : null,
        instructions,
      });
      setInfo(`${res.created} questões geradas. Revise antes de publicar.`);
      await reload();
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setGenerating(false);
    }
  };

  const move = async (q: Question, dir: -1 | 1) => {
    const idx = questions.findIndex((x) => x.id === q.id);
    const other = questions[idx + dir];
    if (!other) return;
    await Promise.all([
      supabase.from("edu_questions").update({ position: other.position }).eq("id", q.id),
      supabase.from("edu_questions").update({ position: q.position }).eq("id", other.id),
    ]);
    void reload();
  };

  const remove = async (q: Question) => {
    setToDelete(null);
    const { error } = await supabase.from("edu_questions").delete().eq("id", q.id);
    if (error) return setError(friendlyError(error));
    void reload();
  };

  const nextPosition = questions.length ? Math.max(...questions.map((q) => q.position)) + 1 : 0;

  return (
    <>
      <section className="card gen-panel">
        <h3>Gerar questões com IA</h3>
        {!pdf ? (
          <p className="muted">Escolha um PDF de referência em Configurações para habilitar a geração.</p>
        ) : (
          <>
            <p className="muted small">
              Fonte: <strong>{pdf.title}</strong> {pdf.page_count ? `(${pdf.page_count} páginas)` : ""}
            </p>
            <div className="gen-grid">
              <label className="field">
                <span>Múltipla escolha</span>
                <input type="number" min={0} max={30} value={mc} onChange={(e) => setMc(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Abertas</span>
                <input type="number" min={0} max={15} value={open} onChange={(e) => setOpen(Number(e.target.value))} />
              </label>
              <label className="field">
                <span>Dificuldade</span>
                <select value={difficulty} onChange={(e) => setDifficulty(e.target.value as typeof difficulty)}>
                  <option value="facil">Fácil</option>
                  <option value="medio">Intermediária</option>
                  <option value="dificil">Difícil</option>
                </select>
              </label>
              <label className="field">
                <span>Da página</span>
                <input type="number" min={1} value={pageFrom} placeholder="início" onChange={(e) => setPageFrom(e.target.value)} />
              </label>
              <label className="field">
                <span>Até a página</span>
                <input type="number" min={1} value={pageTo} placeholder="fim" onChange={(e) => setPageTo(e.target.value)} />
              </label>
            </div>
            <label className="field">
              <span>Orientações para a IA (opcional)</span>
              <input value={instructions} onChange={(e) => setInstructions(e.target.value)} placeholder="Ex.: foque no capítulo 2, use situações do dia a dia" />
            </label>
            <button className="btn btn-primary" disabled={generating || mc + open === 0} onClick={() => void generate()}>
              {generating ? (
                <>
                  <span className="spinner" /> Gerando… (pode levar 1–3 min)
                </>
              ) : (
                `Gerar ${mc + open} questões`
              )}
            </button>
          </>
        )}
      </section>

      <div className="row gap">
        <button className="btn btn-ghost" onClick={() => setCreating("multiple_choice")}>
          + Múltipla escolha manual
        </button>
        <button className="btn btn-ghost" onClick={() => setCreating("open")}>
          + Questão aberta manual
        </button>
      </div>

      {creating && (
        <div className="card">
          <QuestionEditor
            moduleId={mod.id}
            position={nextPosition}
            type={creating}
            onCancel={() => setCreating(null)}
            onSaved={() => {
              setCreating(null);
              void reload();
            }}
          />
        </div>
      )}

      <ol className="q-list">
        {questions.map((q, i) => {
          const key = keys.get(q.id);
          return (
            <li key={q.id} className="card">
              {editingId === q.id ? (
                <QuestionEditor
                  moduleId={mod.id}
                  position={q.position}
                  question={q}
                  answerKey={key}
                  onCancel={() => setEditingId(null)}
                  onSaved={() => {
                    setEditingId(null);
                    void reload();
                  }}
                />
              ) : (
                <>
                  <div className="row between">
                    <span className={`badge ${q.type === "open" ? "badge-alt" : ""}`}>
                      {i + 1}. {q.type === "open" ? "Aberta" : "Múltipla escolha"}
                      {q.source_page ? ` · p. ${q.source_page}` : ""}
                    </span>
                    <div className="row gap-sm">
                      <button className="btn-icon" onClick={() => void move(q, -1)} disabled={i === 0} aria-label="Subir">
                        ↑
                      </button>
                      <button className="btn-icon" onClick={() => void move(q, 1)} disabled={i === questions.length - 1} aria-label="Descer">
                        ↓
                      </button>
                      <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(q.id)}>
                        Editar
                      </button>
                      <button className="btn btn-sm btn-danger" onClick={() => setToDelete(q)}>
                        Excluir
                      </button>
                    </div>
                  </div>
                  <p className="q-prompt-sm">{q.prompt}</p>
                  {q.type === "multiple_choice" ? (
                    <ul className="opt-preview">
                      {q.options.map((o) => (
                        <li key={o.id} className={o.id === key?.correct_option_id ? "correct" : ""}>
                          {o.id === key?.correct_option_id ? "✓ " : ""}
                          {o.text}
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <details>
                      <summary className="small">Resposta modelo e pontos-chave</summary>
                      <p className="small">{key?.expected_answer}</p>
                      <ul className="small">
                        {key?.key_points?.map((p, j) => (
                          <li key={j}>{p}</li>
                        ))}
                      </ul>
                    </details>
                  )}
                  {key?.source_excerpt && <blockquote className="excerpt">“{key.source_excerpt}”</blockquote>}
                </>
              )}
            </li>
          );
        })}
      </ol>
      {!questions.length && <div className="empty">Nenhuma questão ainda. Gere com IA ou crie manualmente.</div>}

      {toDelete && (
        <Modal
          title="Excluir questão"
          onClose={() => setToDelete(null)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setToDelete(null)}>
                Voltar
              </button>
              <button className="btn btn-danger" onClick={() => void remove(toDelete)}>
                Excluir
              </button>
            </>
          }
        >
          <p>As respostas dos alunos a esta questão também serão apagadas.</p>
        </Modal>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function SettingsTab(props: {
  mod: Module;
  pdfs: Pick<PdfFile, "id" | "title">[];
  onSaved: () => void;
  onDeleted: () => void;
  setError: (e: string | null) => void;
}) {
  const { mod, pdfs, onSaved, onDeleted, setError } = props;
  const [form, setForm] = useState({
    title: mod.title,
    description: mod.description ?? "",
    pdf_file_id: mod.pdf_file_id ?? "",
    pass_score: Number(mod.pass_score),
    max_attempts: mod.max_attempts,
    shuffle_options: mod.shuffle_options,
    audience: mod.audience,
  });
  const [students, setStudents] = useState<Pick<Profile, "id" | "email" | "full_name">[]>([]);
  const [granted, setGranted] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    (async () => {
      const [s, g] = await Promise.all([
        supabase.from("edu_profiles").select("id, email, full_name").eq("role", "student").order("full_name"),
        supabase.from("edu_module_students").select("student_id").eq("module_id", mod.id),
      ]);
      setStudents(s.data ?? []);
      setGranted(new Set((g.data ?? []).map((r) => r.student_id)));
    })();
  }, [mod.id]);

  const visibleStudents = useMemo(() => {
    const f = filter.toLowerCase();
    return students.filter((s) => !f || s.email.toLowerCase().includes(f) || (s.full_name ?? "").toLowerCase().includes(f));
  }, [students, filter]);

  const save = async () => {
    setError(null);
    const { error } = await supabase
      .from("edu_modules")
      .update({ ...form, pdf_file_id: form.pdf_file_id || null, description: form.description || null })
      .eq("id", mod.id);
    if (error) return setError(friendlyError(error));
    onSaved();
  };

  const toggleStudent = async (studentId: string) => {
    const has = granted.has(studentId);
    const { error } = has
      ? await supabase.from("edu_module_students").delete().eq("module_id", mod.id).eq("student_id", studentId)
      : await supabase.from("edu_module_students").insert({ module_id: mod.id, student_id: studentId });
    if (error) return setError(friendlyError(error));
    setGranted((prev) => {
      const next = new Set(prev);
      if (has) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const remove = async () => {
    const { error } = await supabase.from("edu_modules").delete().eq("id", mod.id);
    if (error) return setError(friendlyError(error));
    onDeleted();
  };

  return (
    <section className="card settings">
      <label className="field">
        <span>Título</span>
        <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
      </label>
      <label className="field">
        <span>Descrição</span>
        <textarea rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
      </label>
      <label className="field">
        <span>PDF de referência</span>
        <select value={form.pdf_file_id} onChange={(e) => setForm({ ...form, pdf_file_id: e.target.value })}>
          <option value="">— nenhum —</option>
          {pdfs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
      </label>
      <div className="gen-grid">
        <label className="field">
          <span>Nota mínima para aprovação (%)</span>
          <input type="number" min={0} max={100} value={form.pass_score} onChange={(e) => setForm({ ...form, pass_score: Number(e.target.value) })} />
        </label>
        <label className="field">
          <span>Tentativas por questão</span>
          <input type="number" min={1} max={20} value={form.max_attempts} onChange={(e) => setForm({ ...form, max_attempts: Number(e.target.value) })} />
        </label>
      </div>
      <label className="check">
        <input type="checkbox" checked={form.shuffle_options} onChange={(e) => setForm({ ...form, shuffle_options: e.target.checked })} />
        Embaralhar alternativas para cada aluno
      </label>
      <div className="field">
        <span>Quem pode acessar</span>
        <label className="radio">
          <input type="radio" checked={form.audience === "all"} onChange={() => setForm({ ...form, audience: "all" })} /> Todos os alunos ativos
        </label>
        <label className="radio">
          <input type="radio" checked={form.audience === "selected"} onChange={() => setForm({ ...form, audience: "selected" })} /> Somente alunos selecionados
        </label>
      </div>
      {form.audience === "selected" && (
        <div className="student-picker">
          <input placeholder="Filtrar alunos…" value={filter} onChange={(e) => setFilter(e.target.value)} />
          <ul>
            {visibleStudents.map((s) => (
              <li key={s.id}>
                <label className="check">
                  <input type="checkbox" checked={granted.has(s.id)} onChange={() => void toggleStudent(s.id)} />
                  {s.full_name || s.email} <span className="muted small">{s.email}</span>
                </label>
              </li>
            ))}
          </ul>
          <p className="muted small">{granted.size} aluno(s) com acesso. As alterações nesta lista são salvas na hora.</p>
        </div>
      )}
      <div className="row between">
        <button className="btn btn-danger" onClick={() => setConfirmDelete(true)}>
          Excluir módulo
        </button>
        <button className="btn btn-primary" onClick={() => void save()}>
          Salvar configurações
        </button>
      </div>
      {confirmDelete && (
        <Modal
          title="Excluir módulo"
          onClose={() => setConfirmDelete(false)}
          footer={
            <>
              <button className="btn btn-ghost" onClick={() => setConfirmDelete(false)}>
                Voltar
              </button>
              <button className="btn btn-danger" onClick={() => void remove()}>
                Excluir definitivamente
              </button>
            </>
          }
        >
          <p>Apaga o módulo, todas as questões e todas as respostas dos alunos. Não dá para desfazer.</p>
        </Modal>
      )}
    </section>
  );
}

