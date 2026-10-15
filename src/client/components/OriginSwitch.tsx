import type { CSSProperties } from "react";
import type { MenuItem } from "../../shared/ordering";
import { tr } from "../lib/i18n";
import { optionLabel, optionName, optionNote } from "../lib/menuText";

/** Past this many origins the segments get too narrow, so they wrap as chips instead. */
const MAX_SEGMENTS = 4;

/**
 * The origin of a cart line as one sliding switch, like iOS: every origin
 * side by side with its note (كلاسيك، فاكهي), and the highlight slides to
 * the one chosen. A sold-out origin is crossed out.
 */
export function OriginSwitch({ item, value, onChange }: { item: MenuItem; value: string | null; onChange: (optionId: string) => void }) {
  const at = item.options.findIndex((o) => o.id === value);

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
    <div className="origin-switch" role="radiogroup" aria-label={optionLabel(item)} style={{ "--count": item.options.length, "--at": at } as CSSProperties}>
      {/* Nothing chosen yet (the line asks for it): no highlight. */}
      {at >= 0 && <span className="origin-switch__thumb" aria-hidden="true" />}
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
