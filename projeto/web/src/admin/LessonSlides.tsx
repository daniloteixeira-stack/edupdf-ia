import { useState } from "react";
import { supabase, friendlyError } from "../lib/supabase";
import type { LessonSlide } from "../lib/types";
import { Modal } from "../components/Modal";
import { SlideView } from "../student/SlideView";

/** Aba "Aula": revisar, editar, reordenar e criar os slides do módulo. */
export function LessonSlidesTab(props: {
  moduleId: string;
  slides: LessonSlide[];
  nextPosition: number;
  reload: () => Promise<void>;
  setError: (e: string | null) => void;
}) {
  const { moduleId, slides, nextPosition, reload, setError } = props;
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [preview, setPreview] = useState<LessonSlide | null>(null);
  const [toDelete, setToDelete] = useState<LessonSlide | null>(null);

  // Troca a posição com o slide vizinho; as questões entre eles ficam onde estão.
  const move = async (s: LessonSlide, dir: -1 | 1) => {
    const idx = slides.findIndex((x) => x.id === s.id);
    const other = slides[idx + dir];
    if (!other) return;
    const results = await Promise.all([
      supabase.from("edu_lesson_slides").update({ position: other.position }).eq("id", s.id),
      supabase.from("edu_lesson_slides").update({ position: s.position }).eq("id", other.id),
    ]);
    const failed = results.find((r) => r.error);
    if (failed) setError(friendlyError(failed.error));
    void reload();
  };

  const remove = async (s: LessonSlide) => {
    setToDelete(null);
    const { error } = await supabase.from("edu_lesson_slides").delete().eq("id", s.id);
    if (error) return setError(friendlyError(error));
    void reload();
  };

  return (
    <>
      <p className="muted">
        A aula aparece para o aluno intercalada com as questões, na ordem do módulo. Para gerar slides com IA, vá na aba{" "}
        <strong>Questões</strong> e deixe marcada a opção <strong>Criar aula em slides</strong>.
      </p>
      <div className="row gap">
        <button className="btn btn-ghost" onClick={() => setCreating(true)}>
          + Slide manual
        </button>
      </div>

      {creating && (
        <div className="card">
          <SlideEditor
            moduleId={moduleId}
            position={nextPosition}
            onCancel={() => setCreating(false)}
            onSaved={() => {
              setCreating(false);
              void reload();
            }}
            setError={setError}
          />
        </div>
      )}

      <ol className="q-list">
        {slides.map((s, i) => (
          <li key={s.id} className="card">
            {editingId === s.id ? (
              <SlideEditor
                moduleId={moduleId}
                position={s.position}
                slide={s}
                onCancel={() => setEditingId(null)}
                onSaved={() => {
                  setEditingId(null);
                  void reload();
                }}
                setError={setError}
              />
            ) : (
              <>
                <div className="row between">
                  <span className="badge badge-good">
                    Slide {i + 1}
                    {s.source_page ? ` · p. ${s.source_page}` : ""}
                  </span>
                  <div className="row gap-sm">
                    <button className="btn-icon" onClick={() => void move(s, -1)} disabled={i === 0} aria-label="Subir">
                      ↑
                    </button>
                    <button className="btn-icon" onClick={() => void move(s, 1)} disabled={i === slides.length - 1} aria-label="Descer">
                      ↓
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setPreview(s)}>
                      Ver
                    </button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setEditingId(s.id)}>
                      Editar
                    </button>
                    <button className="btn btn-sm btn-danger" onClick={() => setToDelete(s)}>
                      Excluir
                    </button>
                  </div>
                </div>
                <p className="q-prompt-sm">
                  <strong>{s.title}</strong>
                </p>
                <ul className="small">
                  {s.bullets.map((b, j) => (
                    <li key={j}>{b}</li>
                  ))}
                </ul>
              </>
            )}
          </li>
        ))}
      </ol>
      {!slides.length && <div className="empty">Nenhum slide ainda. Gere a aula com IA ou crie manualmente.</div>}

      {preview && (
        <Modal title="Como o aluno vê" onClose={() => setPreview(null)}>
          <SlideView slide={preview} index={slides.findIndex((x) => x.id === preview.id)} total={slides.length} />
        </Modal>
      )}

      {toDelete && (
        <Modal
          title="Excluir slide"
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
            Excluir o slide <strong>{toDelete.title}</strong>?
          </p>
        </Modal>
      )}
    </>
  );
}

function SlideEditor(props: {
  moduleId: string;
  position: number;
  slide?: LessonSlide;
  onCancel: () => void;
  onSaved: () => void;
  setError: (e: string | null) => void;
}) {
  const { moduleId, position, slide, onCancel, onSaved, setError } = props;
  const [title, setTitle] = useState(slide?.title ?? "");
  const [bullets, setBullets] = useState((slide?.bullets ?? []).join("\n"));
  const [explanation, setExplanation] = useState(slide?.explanation ?? "");
  const [highlight, setHighlight] = useState(slide?.highlight ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    setError(null);
    const row = {
      module_id: moduleId,
      position,
      title: title.trim(),
      bullets: bullets.split("\n").map((b) => b.trim()).filter(Boolean),
      explanation: explanation.trim() || null,
      highlight: highlight.trim() || null,
    };
    const { error } = slide
      ? await supabase.from("edu_lesson_slides").update(row).eq("id", slide.id)
      : await supabase.from("edu_lesson_slides").insert(row);
    setSaving(false);
    if (error) return setError(friendlyError(error));
    onSaved();
  };

  return (
    <div className="settings">
      <label className="field">
        <span>Título</span>
        <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} />
      </label>
      <label className="field">
        <span>Tópicos (um por linha)</span>
        <textarea rows={5} value={bullets} onChange={(e) => setBullets(e.target.value)} />
      </label>
      <label className="field">
        <span>Explicação</span>
        <textarea rows={3} value={explanation} onChange={(e) => setExplanation(e.target.value)} />
      </label>
      <label className="field">
        <span>Destaque para memorizar (opcional)</span>
        <input value={highlight} onChange={(e) => setHighlight(e.target.value)} />
      </label>
      <div className="row gap">
        <button className="btn btn-ghost" onClick={onCancel}>
          Cancelar
        </button>
        <button className="btn btn-primary" disabled={saving || !title.trim()} onClick={() => void save()}>
          {saving ? "Salvando…" : "Salvar slide"}
        </button>
      </div>
    </div>
  );
}
