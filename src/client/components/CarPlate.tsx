import {
  arabicDigits,
  carColorHex,
  carColorName,
  carNameText,
  parseCarDescription,
  plateArabic,
  plateLatin,
  type CarDetails,
} from "../../shared/cars";
import { currentLang, tr } from "../lib/i18n";

function PlateHalf({ top, bottom, hint }: { top: string[]; bottom: string[]; hint: boolean }) {
  return (
    <span className={`car-plate__half ${hint ? "is-hint" : ""}`} style={{ gridTemplateColumns: `repeat(${Math.max(bottom.length, 1)}, minmax(0, 1fr))` }}>
      {top.map((c, i) => (
        <span key={`t${i}`}>{c}</span>
      ))}
      {bottom.map((c, i) => (
        <span key={`b${i}`}>{c}</span>
      ))}
    </span>
  );
}

/**
 * A Saudi plate as it looks on the car: digits on the left, letters on the
 * right, Arabic above English, the country band at the edge, and HOLLOW's tent
 * in the middle. It stays white in the dark theme too, like the real one.
 * With `hint`, an empty side shows grey example characters.
 */
export function CarPlate({ letters, numbers, size = "md", hint = false }: { letters: string | null; numbers: string | null; size?: "sm" | "md" | "lg"; hint?: boolean }) {
  const l = letters || (hint ? "HUL" : "");
  const n = numbers || (hint ? "1234" : "");
  const label =
    letters && numbers
      ? tr(`لوحة ${plateArabic(letters)} ${numbers}`, `Plate ${plateLatin(letters)} ${numbers}`)
      : tr("لوحة السيارة", "Car plate");
  // One cell per character, Arabic above English, so both sides spread the same way.
  // The Arabic letters read right to left: their row is the English one mirrored.
  const digits = Array.from(n);
  const latin = Array.from(l);
  return (
    <span className={`car-plate car-plate--${size}`} role="img" aria-label={label} dir="ltr">
      <PlateHalf hint={!numbers} top={Array.from(arabicDigits(n))} bottom={digits} />
      <img className="car-plate__tent" src="/brand/tent-espresso.webp" alt="" width={1100} height={458} />
      <PlateHalf hint={!letters} top={plateArabic(l).split(" ").reverse()} bottom={latin} />
      <span className="car-plate__band" aria-hidden="true">
        <span className="car-plate__country">السعودية</span>
        <span className="car-plate__ksa">
          K<br />S<br />A
        </span>
      </span>
    </span>
  );
}

/** A dot in the car's colour; dashed for a colour the customer wrote. */
export function CarSwatch({ color }: { color: CarDetails["color"] }) {
  const hex = carColorHex(color);
  return <span className={`car-swatch ${hex ? "" : "car-swatch--other"}`} style={hex ? { background: hex } : undefined} aria-hidden="true" />;
}

/** The car in one row: its colour, name and plate. `arabic` for the staff screens. */
export function CarSummary({ car, plate = "sm", arabic = false }: { car: CarDetails; plate?: "sm" | "md" | null; arabic?: boolean }) {
  const en = !arabic && currentLang() === "en";
  return (
    <span className="car-summary">
      <CarSwatch color={car.color} />
      <span className="car-summary__text">
        <strong>{carNameText(car.name, en)}</strong>
        <small>{carColorName(car, en)}</small>
      </span>
      {plate && car.plateLetters && car.plateNumbers && <CarPlate letters={car.plateLetters} numbers={car.plateNumbers} size={plate} />}
    </span>
  );
}

/** An order's car: drawn when the app wrote it, as written for orders from before. */
export function CarDescription({ text, plate = "sm", arabic = false }: { text: string | null; plate?: "sm" | "md" | null; arabic?: boolean }) {
  const car = parseCarDescription(text);
  return car ? <CarSummary car={car} plate={plate} arabic={arabic} /> : <>{text}</>;
}
