import { useEffect, useState } from "react";
import { Link } from "react-router";
import { carColorName, carNameText, MAX_CARS, type CarDetails, type SavedCar } from "../../shared/cars";
import { apiPost } from "../lib/api";
import { keepLocalCar, lastCarId, localCar, rememberCarId, sameCar, useCars } from "../lib/cars";
import { currentLang, tr } from "../lib/i18n";
import { CarPlate, CarSwatch } from "./CarPlate";
import { CarSheet } from "./CarSheet";
import { Spinner } from "./Field";

type Option = { key: string; car: CarDetails };

/**
 * Checkout, curbside: the customer's cars to pick from with one tap, and
 * «سيارة جديدة» to add one. Signed in, a new car is saved to «سياراتي»; a guest's
 * car stays on the phone and joins the account once they sign in.
 */
export function CurbsideCar({ signedIn, onChange, error }: { signedIn: boolean; onChange: (car: CarDetails | null) => void; error?: string | null }) {
  const en = currentLang() === "en";
  const [cars, setCars] = useCars(signedIn);
  const [guestCar, setGuestCar] = useState<CarDetails | null>(localCar);
  const [chosen, setChosen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);

  // A guest's car that couldn't join a full account is still offered.
  const options: Option[] = [
    ...(signedIn ? (cars ?? []).map((c) => ({ key: c.id, car: c })) : []),
    ...(guestCar && !(signedIn && cars?.some((c) => sameCar(c, guestCar))) ? [{ key: "phone", car: guestCar }] : []),
  ];
  const loading = signedIn && cars === null;
  // The car tapped, else the one used last time, else the first one.
  const picked = loading
    ? null
    : (options.find((o) => o.key === chosen) ?? options.find((o) => o.key === lastCarId()) ?? options[0] ?? null);

  useEffect(() => {
    onChange(picked?.car ?? null);
    // onChange is the page's setter; only the car matters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [picked?.key, picked?.car]);

  function pick(key: string) {
    setChosen(key);
    if (key !== "phone") rememberCarId(key);
  }

  async function add(car: CarDetails) {
    if (!signedIn) {
      keepLocalCar(car);
      setGuestCar(car);
      setChosen("phone");
      return;
    }
    const { car: saved } = await apiPost<{ car: SavedCar }>("/api/me/cars", car);
    setCars([...(cars ?? []), saved]);
    pick(saved.id);
  }

  const full = signedIn && (cars?.length ?? 0) >= MAX_CARS;
  return (
    <div className="car-pick">
      <div className="car-pick__head">
        <span className="car-pick__title" id="car-pick-title">
          {tr("سيارتك", "Your car")}
        </span>
        {signedIn && (
          <Link to="/account/cars" className="car-pick__manage">
            {tr("إدارة سياراتي", "My cars")}
          </Link>
        )}
      </div>
      {loading ? (
        <Spinner />
      ) : (
        options.length > 0 && (
          <div className="car-pick__list" role="radiogroup" aria-labelledby="car-pick-title">
            {options.map(({ key, car }) => (
              <button key={key} type="button" role="radio" aria-checked={picked?.key === key} className={`car-option ${picked?.key === key ? "is-on" : ""}`} onClick={() => pick(key)}>
                <span className="car-option__ring" aria-hidden="true" />
                <CarSwatch color={car.color} />
                <span className="car-option__text">
                  <strong>{carNameText(car.name, en)}</strong>
                  <small>{carColorName(car, en)}</small>
                </span>
                {car.plateLetters && car.plateNumbers ? (
                  <CarPlate letters={car.plateLetters} numbers={car.plateNumbers} size="sm" />
                ) : (
                  <small className="car-option__no-plate">{tr("بدون لوحة", "No plate")}</small>
                )}
              </button>
            ))}
          </div>
        )
      )}
      {!loading &&
        (full ? (
          <p className="muted small">{tr(`عندك ${MAX_CARS} سيارات محفوظة. تقدر تعدّلها من «سياراتي».`, `You have ${MAX_CARS} saved cars. Edit them in My cars.`)}</p>
        ) : (
          <button type="button" className="car-pick__add" onClick={() => setAdding(true)}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" aria-hidden="true">
              <path d="M12 5v14M5 12h14" />
            </svg>
            {tr("سيارة جديدة", "New car")}
          </button>
        ))}
      {error && (
        <small className="field__error" role="alert">
          {error}
        </small>
      )}
      <p className="muted small">{tr("لما توصل اضغط «وصلت» من صفحة الطلب، ونطلّع لك طلبك عند السيارة.", "When you arrive, tap \"I'm here\" on the order page and we'll bring your order to your car.")}</p>
      {adding && <CarSheet car={null} title={tr("سيارة جديدة", "New car")} saveLabel={tr("إضافة السيارة", "Add car")} onSave={add} onClose={() => setAdding(false)} />}
    </div>
  );
}
