import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  CAR_COLOR_NAME_MAX_LENGTH,
  CAR_COLORS,
  CAR_NAME_MAX_LENGTH,
  CAR_NAMES,
  carColorName,
  carDescription,
  carNameText,
  normalizeCar,
  plateArabic,
  plateLatin,
  readPlateLetters,
  readPlateNumbers,
  searchCarNames,
  type CarColor,
  type CarDetails,
} from "../../shared/cars";
import { errorText } from "../lib/api";
import { currentLang, tr } from "../lib/i18n";
import { dropSheet } from "../lib/motion";
import { CarPlate, CarSwatch } from "./CarPlate";
import { Alert } from "./Field";
import { useSheetDrag } from "./ProductSheet";

function Check() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 12.5l4.5 4.5L19 7.5" />
    </svg>
  );
}

/**
 * Adds or edits a car, from the bottom of the screen: the car's name and its
 * colour (both needed), then the plate (optional). The plate fills in as it
 * is typed, and after the third letter the numbers box takes over.
 */
export function CarSheet({
  car,
  title,
  saveLabel,
  onSave,
  onClose,
}: {
  car: CarDetails | null;
  title: string;
  saveLabel: string;
  /** Saves the car; a thrown error is shown in the sheet. */
  onSave: (car: CarDetails) => Promise<void> | void;
  onClose: () => void;
}) {
  const en = currentLang() === "en";
  const sheetRef = useRef<HTMLDivElement>(null);
  const lettersRef = useRef<HTMLInputElement>(null);
  const numbersRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const titleId = useId();
  const ids = useId();
  useSheetDrag(sheetRef, null, onClose);

  const [letters, setLetters] = useState(car?.plateLetters ?? "");
  const [shownLetters, setShownLetters] = useState(() => (car?.plateLetters ? (en ? plateLatin(car.plateLetters) : plateArabic(car.plateLetters)) : ""));
  const [rejected, setRejected] = useState<string | null>(null);
  const [numbers, setNumbers] = useState(car?.plateNumbers ?? "");
  const [name, setName] = useState(car?.name ?? "");
  const [query, setQuery] = useState("");
  const [color, setColor] = useState<CarColor | null>(car?.color ?? null);
  const [colorName, setColorName] = useState(car?.colorName ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    if (closing.current) return;
    closing.current = true;
    void dropSheet(sheetRef.current).then(onClose);
  };

  useEffect(() => {
    sheetRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector("dialog[open]") && close();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
    // close() only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const halfPlate = !letters !== !numbers;
  const draft: CarDetails | null =
    color && !halfPlate
      ? normalizeCar({ name, color, colorName: color === "other" ? colorName : null, plateLetters: letters || null, plateNumbers: numbers || null })
      : null;
  const results = searchCarNames(query);
  const typedName = query.trim();

  async function save() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      await onSave(draft);
      close();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  const plateHint = rejected
    ? tr(`«${rejected}» ما يجي في اللوحات السعودية`, `"${rejected}" isn't used on Saudi plates`)
    : halfPlate
      ? letters
        ? tr("أكمل أرقام اللوحة، أو امسح الحروف", "Add the plate's numbers, or clear the letters")
        : tr("أكمل حروف اللوحة، أو امسح الأرقام", "Add the plate's letters, or clear the numbers")
      : tr("عربي أو إنجليزي", "Arabic or English");

  return createPortal(
    <div className="sheet-backdrop" onClick={close}>
      <div ref={sheetRef} className="car-sheet" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} onClick={(e) => e.stopPropagation()}>
        <span className="car-sheet__grabber" aria-hidden="true" />
        <div className="car-sheet__head">
          <h2 id={titleId}>{title}</h2>
          <button type="button" className="car-sheet__close" aria-label={tr("إغلاق", "Close")} onClick={close}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>


        <section className="car-sheet__sec" aria-labelledby={`${ids}-name`}>
          <span id={`${ids}-name`} className="car-sheet__label">
            {tr("اسم السيارة", "Car")}
          </span>
          {name ? (
            <div className="car-sheet__picked">
              <span className="car-sheet__picked-check">
                <Check />
              </span>
              <span className="car-sheet__picked-text">
                <strong>{carNameText(name, en)}</strong>
                {!en && CAR_NAMES.some(([ar]) => ar === name) && <small dir="ltr">{carNameText(name, true)}</small>}
              </span>
              <button
                type="button"
                className="link-btn"
                onClick={() => {
                  setQuery(name);
                  setName("");
                }}
              >
                {tr("تغيير", "Change")}
              </button>
            </div>
          ) : (
            <>
              <div className="car-sheet__search">
                <input
                  type="search"
                  autoComplete="off"
                  enterKeyHint="done"
                  maxLength={CAR_NAME_MAX_LENGTH}
                  value={query}
                  placeholder={tr("مثال: كامري، سوناتا، جمس", "e.g. Camry, Sonata, GMC")}
                  aria-label={tr("ابحث عن اسم السيارة", "Search for your car")}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    const first = results[0];
                    if (first) setName(first[0]);
                    else if (typedName) setName(typedName);
                  }}
                />
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3.5-3.5" />
                </svg>
              </div>
              <span className="car-sheet__list-title">
                {typedName ? (results.length ? tr("النتائج", "Results") : tr("ما لقيناها في القائمة", "Not in our list")) : tr("الأشهر", "Popular")}
              </span>
              <div className="car-sheet__chips">
                {results.map(([ar, enName]) => (
                  <button key={ar} type="button" className="car-chip" onClick={() => setName(ar)}>
                    {en ? enName : ar}
                  </button>
                ))}
                {typedName && !results.some(([ar, enName]) => ar === typedName || enName.toLowerCase() === typedName.toLowerCase()) && (
                  <button type="button" className="car-chip car-chip--own" onClick={() => setName(typedName)}>
                    {tr(`استخدم «${typedName}»`, `Use "${typedName}"`)}
                  </button>
                )}
              </div>
            </>
          )}
        </section>

        <section className="car-sheet__sec" aria-labelledby={`${ids}-color`}>
          <div className="car-sheet__label">
            <span id={`${ids}-color`}>{tr("اللون", "Colour")}</span>
            {color && color !== "other" && <span className="car-sheet__chosen">{carColorName({ color, colorName: null }, en)}</span>}
          </div>
          <div className="car-sheet__colors" role="radiogroup" aria-labelledby={`${ids}-color`}>
            {[...CAR_COLORS.map((c) => c.key), "other" as const].map((key) => {
              const on = color === key;
              return (
                <button key={key} type="button" role="radio" aria-checked={on} className={`car-color ${on ? "is-on" : ""} ${key === "black" || key === "gray" ? "car-color--dark" : key === "other" ? "car-color--own" : ""}`} onClick={() => setColor(key)}>
                  <span className="car-color__dot">
                    <CarSwatch color={key} />
                    {on ? <Check /> : key === "other" && <span className="car-color__plus" aria-hidden="true">+</span>}
                  </span>
                  <span className="car-color__name">{key === "other" ? tr("لون آخر", "Other") : carColorName({ color: key, colorName: null }, en)}</span>
                </button>
              );
            })}
          </div>
          {color === "other" && (
            <div className="field">
              <label htmlFor={`${ids}-own-color`}>{tr("اكتب لون سيارتك", "Your car's colour")}</label>
              <input
                id={`${ids}-own-color`}
                autoComplete="off"
                maxLength={CAR_COLOR_NAME_MAX_LENGTH}
                value={colorName}
                placeholder={tr("مثال: عنابي، ذهبي، تركوازي", "e.g. maroon, gold, teal")}
                onChange={(e) => setColorName(e.target.value)}
              />
            </div>
          )}
        </section>

        <section className="car-sheet__sec" aria-labelledby={`${ids}-plate`}>
          <div className="car-sheet__label">
            <span id={`${ids}-plate`}>{tr("لوحة السيارة", "Plate")}</span>
            <span className="car-sheet__optional">{tr("اختياري", "Optional")}</span>
          </div>
          <p className="car-sheet__note">{tr("تساعدنا نعرف سيارتك أسرع، وتقدر تتركها فاضية", "Helps us spot your car faster. You can leave it empty")}</p>
          <div className="car-sheet__plate">
            <CarPlate letters={letters} numbers={numbers} size="lg" hint />
          </div>
          <div className="car-sheet__plate-inputs">
            <div className="field">
              <label htmlFor={`${ids}-letters`}>{tr("الحروف", "Letters")}</label>
              <input
                ref={lettersRef}
                id={`${ids}-letters`}
                className="car-sheet__plate-input"
                dir="auto"
                autoComplete="off"
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                enterKeyHint="next"
                value={shownLetters}
                placeholder={en ? "H U L" : "ه‍ و ل"}
                aria-describedby={`${ids}-plate-hint`}
                onChange={(e) => {
                  const read = readPlateLetters(e.target.value);
                  const filled = read.letters.length === 3 && letters.length < 3;
                  setLetters(read.letters);
                  setShownLetters(read.shown);
                  setRejected(read.rejected);
                  if (filled) numbersRef.current?.focus();
                }}
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), numbersRef.current?.focus())}
              />
            </div>
            <div className="field">
              <label htmlFor={`${ids}-numbers`}>{tr("الأرقام", "Numbers")}</label>
              <input
                ref={numbersRef}
                id={`${ids}-numbers`}
                className="car-sheet__plate-input car-sheet__plate-input--digits"
                dir="ltr"
                inputMode="numeric"
                autoComplete="off"
                enterKeyHint="done"
                value={numbers}
                placeholder="1234"
                aria-describedby={`${ids}-plate-hint`}
                onChange={(e) => setNumbers(readPlateNumbers(e.target.value))}
                onKeyDown={(e) => {
                  if (e.key === "Backspace" && !numbers) {
                    e.preventDefault();
                    lettersRef.current?.focus();
                  }
                }}
              />
            </div>
          </div>
          <small id={`${ids}-plate-hint`} className={rejected || halfPlate ? "field__error" : "field__hint"} aria-live="polite">
            {plateHint}
          </small>
        </section>

        <div className="car-sheet__foot">
          {draft && (
            <p className="car-sheet__summary">
              <CarSwatch color={draft.color} />
              <span>{en ? [carNameText(draft.name, true), carColorName(draft, true), draft.plateLetters ? `${plateLatin(draft.plateLetters)} ${draft.plateNumbers}` : null].filter(Boolean).join(" · ") : carDescription(draft)}</span>
            </p>
          )}
          {error && <Alert tone="error">{error}</Alert>}
          <button type="button" className="btn btn--primary btn--block btn--lg" disabled={!draft || busy} onClick={() => void save()}>
            {busy ? tr("جارٍ الحفظ…", "Saving…") : saveLabel}
          </button>
          {!draft && !halfPlate && <small className="car-sheet__why">{tr("اختر اسم السيارة ولونها", "Pick your car and its colour")}</small>}
        </div>
      </div>
    </div>,
    document.body,
  );
}
