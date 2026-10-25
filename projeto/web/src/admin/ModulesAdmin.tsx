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
        <p className="muted">Crie um módulo, ligue a um PDF e gere as questões com IA.</p>
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
                <th>Módulo</th>
                <th>PDF</th>
                <th>Questões</th>
                <th>Status</th>
                <th>Criado em</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((m) => (
                <tr key={m.id} onClick={() => navigate(`/admin/modulos/${m.id}`)}>
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
                  <td colSpan={5} className="empty">
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
