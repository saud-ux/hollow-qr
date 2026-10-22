import type { CSSProperties } from "react";
import { DRINK_TEMPERATURES, type DrinkTemperature } from "../../shared/drink-temperature";
import { tr } from "../lib/i18n";
import { tapFeedback } from "../lib/native";

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
 * Hot / cold, in the search dock under the menu: each takes the menu to its
 * group of drinks, and the thumb sits on the group in view. Nothing is hidden.
 */
export function TemperatureSwitch({ value, onChange, tabbable = true }: { value: DrinkTemperature; onChange: (value: DrinkTemperature) => void; tabbable?: boolean }) {
  return (
    <div className="temp-switch" style={{ "--i": DRINK_TEMPERATURES.indexOf(value) } as CSSProperties}>
      <span className="temp-switch__thumb" aria-hidden="true" />
      {DRINK_TEMPERATURES.map((choice) => (
        <button
          key={choice}
          type="button"
          className={`temp-switch__option${choice === value ? " is-on" : ""}`}
          aria-current={choice === value ? "true" : undefined}
          tabIndex={tabbable ? 0 : -1}
          onClick={() => {
            tapFeedback();
            onChange(choice);
          }}
        >
          <TemperatureIcon value={choice} size={18} />
          {choice === "hot" ? tr("حار", "Hot") : tr("بارد", "Cold")}
        </button>
      ))}
    </div>
  );
}
