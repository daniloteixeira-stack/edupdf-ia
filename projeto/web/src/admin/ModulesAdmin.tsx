import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { supabase, friendlyError } from "../lib/supabase";
import { useAuth } from "../auth/AuthProvider";
import { fmtDate } from "../lib/format";
import type { Module, PdfFile } from "../lib/types";

type Row = Module & { questions: Array<{ count: number }>; pdf_files: { title: string } | null };

export function ModulesAdmin() {
  const { profile } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<Row[] | null>(null);
  const [pdfs, setPdfs] = useState<Pick<PdfFile, "id" | "title">[]>([]);
  const [title, setTitle] = useState("");
  const [pdfId, setPdfId] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const [m, p] = await Promise.all([
        supabase.from("edu_modules").select("*, questions:edu_questions(count), pdf_files:edu_pdf_files(title)").order("created_at", { ascending: false }),
        supabase.from("edu_pdf_files").select("id, title").eq("status", "ready").order("created_at", { ascending: false }),
      ]);
      if (m.error || p.error) setError(friendlyError(m.error ?? p.error));
      setRows((m.data ?? []) as Row[]);
      setPdfs(p.data ?? []);
    })();
  }, []);

  // Ordem da trilha do aluno: publicados primeiro, na ordem definida; rascunhos depois.
  const trail = (rows ?? [])
    .filter((m) => m.is_published)
    .sort((a, b) => (a.trail_position ?? Infinity) - (b.trail_position ?? Infinity) || a.created_at.localeCompare(b.created_at));
  const drafts = (rows ?? []).filter((m) => !m.is_published);

  const move = async (index: number, delta: number) => {
    const order = [...trail];
    const [item] = order.splice(index, 1);
    order.splice(index + delta, 0, item);
    const positions = new Map(order.map((m, i) => [m.id, i + 1]));
    setRows((prev) => (prev ?? []).map((m) => (positions.has(m.id) ? { ...m, trail_position: positions.get(m.id)! } : m)));
    const results = await Promise.all(
      order.map((m, i) => supabase.from("edu_modules").update({ trail_position: i + 1 }).eq("id", m.id)),
    );
    const failed = results.find((r) => r.error);
    if (failed) setError(friendlyError(failed.error));
  };

  const create = async (e: FormEvent) => {
    e.preventDefault();
    if (!title.trim()) return;
    const { data, error } = await supabase
      .from("edu_modules")
      .insert({ title: title.trim(), pdf_file_id: pdfId || null, created_by: profile!.id })
      .select("id")
      .single();
    if (error) return setError(friendlyError(error));
    navigate(`/admin/modulos/${data.id}`);
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Módulos</h1>
        <p className="muted">Crie um módulo, ligue a um PDF e gere as questões com IA. Os publicados formam a trilha do aluno, na ordem abaixo: cada um abre quando o anterior é aprovado.</p>
      </header>

      <form className="card row gap wrap" onSubmit={create}>
        <input className="grow" placeholder="Título do novo módulo" value={title} onChange={(e) => setTitle(e.target.value)} />
        <select value={pdfId} onChange={(e) => setPdfId(e.target.value)}>
          <option value="">PDF de referência…</option>
          {pdfs.map((p) => (
            <option key={p.id} value={p.id}>
              {p.title}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!title.trim()}>
          Criar módulo
        </button>
      </form>
      {error && <div className="alert alert-error">{error}</div>}

      {!rows ? (
        <div className="loading">Carregando…</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Trilha</th>
                <th>Módulo</th>
                <th>PDF</th>
                <th>Questões</th>
                <th>Status</th>
                <th>Criado em</th>
              </tr>
            </thead>
            <tbody>
              {[...trail, ...drafts].map((m) => (
                <tr key={m.id} onClick={() => navigate(`/admin/modulos/${m.id}`)}>
                  <td onClick={(e) => e.stopPropagation()}>
                    {m.is_published ? (
                      <span className="order-btns">
                        <strong>{trail.indexOf(m) + 1}</strong>
                        <button className="btn btn-ghost btn-sm" disabled={trail.indexOf(m) === 0} onClick={() => move(trail.indexOf(m), -1)} aria-label="Subir na trilha">
                          ↑
                        </button>
                        <button className="btn btn-ghost btn-sm" disabled={trail.indexOf(m) === trail.length - 1} onClick={() => move(trail.indexOf(m), 1)} aria-label="Descer na trilha">
                          ↓
                        </button>
                      </span>
                    ) : (
                      <span className="muted">—</span>
                    )}
                  </td>
                  <td>
                    <Link to={`/admin/modulos/${m.id}`}>
                      <strong>{m.title}</strong>
                    </Link>
                  </td>
                  <td>{m.pdf_files?.title ?? <span className="muted">—</span>}</td>
                  <td>{m.questions?.[0]?.count ?? 0}</td>
                  <td>
                    <span className={`status ${m.is_published ? "status-active" : "status-paused"}`}>{m.is_published ? "Publicado" : "Rascunho"}</span>
                  </td>
                  <td>{fmtDate(m.created_at)}</td>
                </tr>
              ))}
              {!rows.length && (
                <tr>
                  <td colSpan={6} className="empty">
                    Nenhum módulo ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
