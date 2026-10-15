import { useLayoutEffect, useRef, useState } from "react";
import type { MenuItem } from "../../shared/ordering";
import { tr } from "../lib/i18n";
import { optionLabel, optionName, optionNote } from "../lib/menuText";

/** Past this many origins the segments get too narrow, so they wrap as chips instead. */
const MAX_SEGMENTS = 4;

/**
 * The origin of a cart line as one sliding switch, like iOS: every origin
 * side by side with its note (كلاسيك، فاكهي), and the highlight slides to
 * the one chosen. Segments are as wide as their names need, so a long one
 * («Costa Rican») shows whole; the highlight measures the chosen segment.
 * A sold-out origin is crossed out.
 */
export function OriginSwitch({ item, value, onChange }: { item: MenuItem; value: string | null; onChange: (optionId: string) => void }) {
  const at = item.options.findIndex((o) => o.id === value);
  const ref = useRef<HTMLDivElement>(null);
  const [thumb, setThumb] = useState<{ x: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const segments = [...root.querySelectorAll<HTMLElement>(".origin-switch__option")];
    const measure = () => {
      const chosen = segments[at];
      setThumb(chosen ? { x: chosen.offsetLeft, width: chosen.offsetWidth } : null);
    };
    measure();
    // Widths change when the font arrives, the language flips or the screen turns.
    const observer = new ResizeObserver(measure);
    for (const el of [root, ...segments]) observer.observe(el);
    return () => observer.disconnect();
  }, [at, item.options.length]);

  if (item.options.length > MAX_SEGMENTS) {
    return (
      <div className="cart-origins" role="radiogroup" aria-label={optionLabel(item)}>
        {item.options.map((o) => (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={`cart-origin ${value === o.id ? "is-on" : ""}`}
            disabled={!o.isAvailable}
            onClick={() => onChange(o.id)}
          >
            {optionName(o)}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div ref={ref} className="origin-switch" role="radiogroup" aria-label={optionLabel(item)}>
      {/* Nothing chosen yet (the line asks for it): no highlight. */}
      {thumb && <span className="origin-switch__thumb" aria-hidden="true" style={{ width: thumb.width, transform: `translateX(${thumb.x}px)` }} />}
      {item.options.map((o) => {
        const note = o.isAvailable ? optionNote(o) : tr("نفد", "Sold out");
        return (
          <button
            key={o.id}
            type="button"
            role="radio"
            aria-checked={value === o.id}
            className={`origin-switch__option ${value === o.id ? "is-on" : ""}`}
            disabled={!o.isAvailable}
            onClick={() => value !== o.id && onChange(o.id)}
          >
            <span className="origin-switch__name">{optionName(o)}</span>
            {note && <small className="origin-switch__note">{note}</small>}
          </button>
        );
      })}
    </div>
  );
}
