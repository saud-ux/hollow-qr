import type { CSSProperties, Ref } from "react";
import type { DrinkTemperature } from "../../shared/drink-temperature";
import { tr } from "../lib/i18n";
import { tapFeedback } from "../lib/native";

/** null: all drinks. */
export type TemperatureChoice = DrinkTemperature | null;

export function TemperatureIcon({ value, size = 20 }: { value: DrinkTemperature; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {value === "hot" ? (
        <path d="M4 10h13v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5v-5ZM17 11h2a3 3 0 0 1 0 6h-2M8 7c-3-3 2-3 0-6M13 7c-3-3 2-3 0-6" />
      ) : (
        <>
          <path d="M5 6h14l-2 15H7L5 6ZM4 6h16M14 6l2-5" />
          <path d="m8 10 3 1-1 3-3-1 1-3Zm5 5 3-1 1 3-3 1-1-3Z" />
        </>
      )}
    </svg>
  );
}

/**
 * The HOLLOW cup from the card (and drinks without a photo), with steam rising
 * from a hot one and ice floating in a cold one. The overlay is drawn in the
 * picture's own pixels (240 x 284; the coffee is the ellipse at 120, 51). It
 * paints over the lighter crema in the middle so the coffee is one dark colour.
 */
function CupArt({ value }: { value: DrinkTemperature }) {
  return (
    <span className="temp-tile__cup" aria-hidden="true">
      <img src="/wallet-preview/cup-open.png" alt="" width={240} height={284} />
      <svg viewBox="0 0 240 284">
        <ellipse cx="119.5" cy="52" rx="61" ry="8.6" fill="#5c3a22" />
        {value === "hot" ? (
          <g fill="none" stroke="#bdb0a3" strokeWidth="5" strokeLinecap="round" opacity="0.85">
            <path d="M94 34c-9-9 9-15 0-24s9-15 0-24" />
            <path d="M120 28c-9-9 9-15 0-24s9-15 0-24" />
            <path d="M146 34c-9-9 9-15 0-24s9-15 0-24" />
          </g>
        ) : (
          <g fill="#fbf7f0" stroke="#e6d9c3" strokeWidth="1.5" opacity="0.85">
            <rect x="80" y="38" width="26" height="18" rx="5" transform="rotate(-12 93 47)" />
            <rect x="128" y="36" width="26" height="19" rx="5" transform="rotate(10 141 45)" />
            <rect x="106" y="46" width="20" height="13" rx="4" />
          </g>
        )}
      </svg>
    </span>
  );
}

function drinkCount(n: number): string {
  const ar = n === 1 ? "مشروب واحد" : n === 2 ? "مشروبان" : n <= 10 ? `${n} مشروبات` : n % 100 >= 11 ? `${n} مشروبًا` : `${n} مشروب`;
  return tr(ar, `${n} ${n === 1 ? "drink" : "drinks"}`);
}

/** At the top of the drinks: one card for hot drinks, one for cold. Tapping the chosen one again shows all. */
export function TemperatureTiles({ value, counts, onChange, ref }: { value: TemperatureChoice; counts: Record<DrinkTemperature, number>; onChange: (value: TemperatureChoice) => void; ref?: Ref<HTMLDivElement> }) {
  return (
    <div ref={ref} className="temp-tiles" role="group" aria-label={tr("نوع المشروبات", "Drink temperature")}>
      {(["hot", "cold"] as const).map((t) => (
        <button
          key={t}
          type="button"
          className={`temp-tile${value === t ? " is-on" : ""}`}
          aria-pressed={value === t}
          onClick={() => {
            tapFeedback();
            onChange(value === t ? null : t);
          }}
        >
          <span className="temp-tile__name">{t === "hot" ? tr("حارّة", "Hot") : tr("باردة", "Cold")}</span>
          <span className="temp-tile__count">{drinkCount(counts[t])}</span>
          <CupArt value={t} />
        </button>
      ))}
    </div>
  );
}

const CHOICES: TemperatureChoice[] = [null, "hot", "cold"];

/** All / hot / cold, with a thumb that slides to the choice (in the search dock once the cards are scrolled away). */
export function TemperatureSwitch({ value, onChange, tabbable = true }: { value: TemperatureChoice; onChange: (value: TemperatureChoice) => void; tabbable?: boolean }) {
  return (
    <div className="temp-switch" style={{ "--i": CHOICES.indexOf(value) } as CSSProperties}>
      <span className="temp-switch__thumb" aria-hidden="true" />
      {CHOICES.map((choice) => (
        <button
          key={choice ?? "all"}
          type="button"
          className={`temp-switch__option${choice === value ? " is-on" : ""}`}
          aria-pressed={choice === value}
          tabIndex={tabbable ? 0 : -1}
          onClick={() => {
            tapFeedback();
            onChange(choice);
          }}
        >
          {choice && <TemperatureIcon value={choice} size={18} />}
          {choice === null ? tr("الكل", "All") : choice === "hot" ? tr("حار", "Hot") : tr("بارد", "Cold")}
        </button>
      ))}
    </div>
  );
}
