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

/** A HOLLOW paper cup: steam over a hot one, ice in a cold one. */
function CupArt({ value }: { value: DrinkTemperature }) {
  return (
    <svg className="temp-tile__cup" viewBox="0 0 100 86" aria-hidden="true">
      {value === "hot" && (
        <g fill="none" stroke="#bdb0a3" strokeWidth="1.6" strokeLinecap="round" opacity="0.85">
          <path d="M44 18c-3-3 3-5 0-8s3-5 0-8" />
          <path d="M56 18c-3-3 3-5 0-8s3-5 0-8" />
        </g>
      )}
      <path d="M27 24 L73 24 L67 86 L33 86 Z" fill="#e6d3ba" />
      <ellipse cx="50" cy="24" rx="23.5" ry="5.2" fill="#f6eee3" />
      <ellipse cx="50" cy="24.6" rx="21" ry="3.8" fill={value === "hot" ? "#23150c" : "#3a2212"} />
      {value === "cold" && (
        <g fill="#fbf7f0" opacity="0.7">
          <rect x="37" y="19.5" width="8" height="6" rx="1.5" transform="rotate(-12 41 22)" />
          <rect x="52" y="19" width="8" height="6.5" rx="1.5" transform="rotate(10 56 22)" />
          <rect x="45" y="22" width="6" height="4" rx="1.2" />
        </g>
      )}
      <text x="50" y="43" textAnchor="middle" direction="ltr" fontFamily="Georgia, serif" fontWeight="700" fontSize="8.6" fill="#8e3a2b">
        HOLLOW
      </text>
      <g fill="none" stroke="#b5705c" strokeWidth="0.7" strokeLinejoin="round" strokeLinecap="round">
        <path d="M32 57 q8-6 13-2 q6-5 11 0 q6-4 12 2" />
        <path d="M36 80 L50 65 L64 80" />
      </g>
    </svg>
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
