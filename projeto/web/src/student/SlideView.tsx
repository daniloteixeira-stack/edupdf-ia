import { useEffect } from "react";
import type { LessonSlide } from "../lib/types";

/** Slide de aula em tela cheia do cartão. Enter ou → avança, ← volta. */
export function SlideView(props: {
  slide: LessonSlide;
  index: number;
  total: number;
  onNext?: () => void;
  onPrev?: () => void;
}) {
  const { slide, index, total, onNext, onPrev } = props;

  useEffect(() => {
    if (!onNext && !onPrev) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if ((e.key === "Enter" || e.key === "ArrowRight") && onNext) {
        e.preventDefault();
        onNext();
      } else if (e.key === "ArrowLeft" && onPrev) {
        e.preventDefault();
        onPrev();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onNext, onPrev]);

  return (
    <article className="slide" key={slide.id}>
      <div className="slide-top muted small">
        <span>
          📖 Aula · slide {index + 1} de {total}
        </span>
        {slide.source_page && <span>PDF p. {slide.source_page}</span>}
      </div>
      <h2 className="slide-title">{slide.title}</h2>
      {slide.bullets.length > 0 && (
        <ul className="slide-bullets">
          {slide.bullets.map((b, i) => (
            <li key={i} style={{ animationDelay: `${i * 90}ms` }}>
              {b}
            </li>
          ))}
        </ul>
      )}
      {slide.explanation && <p className="slide-text">{slide.explanation}</p>}
      {slide.highlight && (
        <div className="slide-highlight">
          <strong>Para lembrar:</strong> {slide.highlight}
        </div>
      )}
      {(onNext || onPrev) && (
        <div className="row between slide-nav">
          {onPrev ? (
            <button className="btn btn-ghost" onClick={onPrev}>
              ← Voltar
            </button>
          ) : (
            <span />
          )}
          {onNext && (
            <button className="btn btn-primary" onClick={onNext} autoFocus>
              Continuar →
            </button>
          )}
        </div>
      )}
    </article>
  );
}
