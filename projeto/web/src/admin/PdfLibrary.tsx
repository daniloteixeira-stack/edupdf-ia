import { useCallback, useEffect, useRef, useState, type DragEvent } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import { fmtBytes, fmtDate } from "../lib/format";
import { useAuth } from "../auth/AuthProvider";
import { Modal } from "../components/Modal";
import { pdfStorage } from "../lib/api";
import type { PdfFile } from "../lib/types";

const MAX_BYTES = 50 * 1024 * 1024;

interface UploadJob {
  name: string;
  stage: string;
  pct: number;
  error?: string;
}

/** Biblioteca de PDFs: upload para o Storage + extração do texto base para a IA. */
export function PdfLibrary() {
  const { profile } = useAuth();
  const [files, setFiles] = useState<PdfFile[] | null>(null);
  const [jobs, setJobs] = useState<UploadJob[]>([]);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [editing, setEditing] = useState<{ id: string; title: string } | null>(null);
  const [toDelete, setToDelete] = useState<PdfFile | null>(null);
  const [preview, setPreview] = useState<{ title: string; url: string } | null>(null);

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("edu_pdf_files")
      .select("id, title, original_name, storage_path, size_bytes, page_count, char_count, status, error_message, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(friendlyError(error));
    setFiles((data ?? []) as PdfFile[]);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const update = (name: string, patch: Partial<UploadJob>) =>
    setJobs((prev) => prev.map((j) => (j.name === name ? { ...j, ...patch } : j)));

  const processFile = async (file: File) => {
    const name = file.name;
    setJobs((prev) => [...prev.filter((j) => j.name !== name), { name, stage: "Lendo PDF", pct: 0 }]);
    try {
      if (file.type !== "application/pdf" && !name.toLowerCase().endsWith(".pdf")) throw new Error("O arquivo não é um PDF.");
      if (file.size > MAX_BYTES) throw new Error("O PDF passa de 50 MB.");

      const { extractPdfText } = await import("../lib/pdf"); // pdf.js só carrega para o professor
      const { text, pageCount } = await extractPdfText(file, (page, total) =>
        update(name, { stage: `Extraindo texto (página ${page}/${total})`, pct: Math.round((page / total) * 70) }),
      );
      const plain = text.replace(/\[\[página \d+\]\]/g, "").trim();

      update(name, { stage: "Enviando arquivo", pct: 80 });
      const { path, token } = await pdfStorage.signUpload();
      const { error: upErr } = await supabase.storage.from("edu-pdfs").uploadToSignedUrl(path, token, file, { contentType: "application/pdf" });
      if (upErr) throw upErr;

      update(name, { stage: "Salvando", pct: 95 });
      const hasText = plain.length >= 200;
      const { error: insErr } = await supabase.from("edu_pdf_files").insert({
        owner_id: profile!.id,
        title: name.replace(/\.pdf$/i, ""),
        original_name: name,
        storage_path: path,
        size_bytes: file.size,
        page_count: pageCount,
        extracted_text: hasText ? text : null,
        status: hasText ? "ready" : "error",
        error_message: hasText ? null : "PDF sem texto selecionável (provavelmente escaneado). Gere uma versão com OCR e envie de novo.",
      });
      if (insErr) {
        await pdfStorage.remove(path).catch(() => undefined);
        throw insErr;
      }
      update(name, { stage: "Concluído", pct: 100 });
      setTimeout(() => setJobs((prev) => prev.filter((j) => j.name !== name)), 2500);
      void load();
    } catch (err) {
      update(name, { stage: "Falhou", error: friendlyError(err), pct: 100 });
    }
  };

  const onFiles = (list: FileList | null) => {
    if (!list) return;
    for (const f of Array.from(list)) void processFile(f);
  };

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    onFiles(e.dataTransfer.files);
  };

  const open = async (f: PdfFile) => {
    try {
      const { url } = await pdfStorage.signDownload(f.storage_path);
      setPreview({ title: f.title, url });
    } catch (err) {
      setError(friendlyError(err));
    }
  };

  const saveTitle = async () => {
    if (!editing) return;
    const title = editing.title.trim();
    setEditing(null);
    if (!title) return;
    const { error } = await supabase.from("edu_pdf_files").update({ title }).eq("id", editing.id);
    if (error) return setError(friendlyError(error));
    void load();
  };

  const remove = async (f: PdfFile) => {
    setToDelete(null);
    const { error } = await supabase.from("edu_pdf_files").delete().eq("id", f.id);
    if (error) return setError(friendlyError(error));
    await pdfStorage.remove(f.storage_path).catch(() => undefined);
    void load();
  };

  return (
    <div className="page">
      <header className="page-head">
        <h1>Biblioteca de PDFs</h1>
        <p className="muted">Os PDFs são a base de conhecimento: a IA gera e corrige questões somente a partir do texto deles.</p>
      </header>

      <div
        className={`dropzone ${dragging ? "over" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        onClick={() => inputRef.current?.click()}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => e.key === "Enter" && inputRef.current?.click()}
      >
        <strong>Arraste PDFs aqui</strong> ou clique para escolher (até 50 MB cada)
        <input ref={inputRef} type="file" accept="application/pdf,.pdf" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      </div>

      {jobs.map((j) => (
        <div key={j.name} className={`job ${j.error ? "job-error" : ""}`}>
          <div className="row between">
            <strong>{j.name}</strong>
            <span className="muted small">{j.stage}</span>
          </div>
          <div className="progress">
            <div style={{ width: `${j.pct}%` }} />
          </div>
          {j.error && <div className="small bad">{j.error}</div>}
        </div>
      ))}
      {error && <div className="alert alert-error">{error}</div>}

      {!files ? (
        <div className="loading">Carregando…</div>
      ) : files.length === 0 ? (
        <div className="empty">Nenhum PDF enviado ainda.</div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Título</th>
                <th>Páginas</th>
                <th>Texto extraído</th>
                <th>Tamanho</th>
                <th>Enviado em</th>
                <th className="right">Ações</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id}>
                  <td>
                    {editing?.id === f.id ? (
                      <input
                        autoFocus
                        value={editing.title}
                        onChange={(e) => setEditing({ id: f.id, title: e.target.value })}
                        onBlur={() => void saveTitle()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveTitle();
                          if (e.key === "Escape") setEditing(null);
                        }}
                      />
                    ) : (
                      <strong>{f.title}</strong>
                    )}
                    <div className="muted small">{f.original_name}</div>
                  </td>
                  <td>{f.page_count ?? "—"}</td>
                  <td>
                    {f.status === "ready" ? (
                      <span className="status status-active">{f.char_count.toLocaleString("pt-BR")} caracteres</span>
                    ) : (
                      <span className="status status-blocked" title={f.error_message ?? ""}>
                        Sem texto
                      </span>
                    )}
                  </td>
                  <td>{fmtBytes(f.size_bytes)}</td>
                  <td>{fmtDate(f.created_at)}</td>
                  <td className="right nowrap">
                    <button className="btn btn-sm btn-ghost" onClick={() => void open(f)}>
                      Abrir
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditing({ id: f.id, title: f.title })}>
                      Renomear
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => setToDelete(f)}>
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {preview && (
        <Modal title={preview.title} onClose={() => setPreview(null)}>
          <iframe className="pdf-frame" src={preview.url} title={preview.title} />
        </Modal>
      )}

      {toDelete && (
        <Modal
          title="Excluir PDF"
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
          <p>
            Excluir <strong>{toDelete.title}</strong>? Módulos ligados a ele continuam existindo, mas perdem o material de referência
            para a correção das questões abertas.
          </p>
        </Modal>
      )}
    </div>
  );
}
