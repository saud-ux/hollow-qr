import { useEffect, useState } from "react";
import { MAX_CARS, normalizeCar, type CarDetails, type SavedCar } from "../../shared/cars";
import { apiGet, apiPost } from "./api";

/** A guest's car, kept on this phone until they sign in; then it moves to their account. */
const LOCAL_CAR_KEY = "hollow.car";
/** The car picked last time, chosen first at the next checkout. */
const LAST_CAR_KEY = "hollow.car.last";

export function localCar(): CarDetails | null {
  try {
    const raw = localStorage.getItem(LOCAL_CAR_KEY);
    // Before saved cars this held free text such as «كامري بيضاء»: not a car to reuse.
    return raw?.startsWith("{") ? normalizeCar(JSON.parse(raw) as CarDetails) : null;
  } catch {
    return null;
  }
}

export function keepLocalCar(car: CarDetails | null) {
  try {
    if (car) localStorage.setItem(LOCAL_CAR_KEY, JSON.stringify(car));
    else localStorage.removeItem(LOCAL_CAR_KEY);
  } catch {
    // storage blocked: the car is only used for this order
  }
}

export function lastCarId(): string | null {
  try {
    return localStorage.getItem(LAST_CAR_KEY);
  } catch {
    return null;
  }
}

export function rememberCarId(id: string) {
  try {
    localStorage.setItem(LAST_CAR_KEY, id);
  } catch {
    // storage blocked: the first car is picked next time
  }
}

export const sameCar = (a: CarDetails, b: CarDetails) =>
  a.name === b.name && a.color === b.color && a.colorName === b.colorName && a.plateLetters === b.plateLetters && a.plateNumbers === b.plateNumbers;

/**
 * The signed-in customer's saved cars (null while loading). A car added as a
 * guest on this phone is saved to the account on the way (it stays on the
 * phone while the account already has 5).
 */
export function useCars(enabled: boolean): [SavedCar[] | null, (cars: SavedCar[]) => void] {
  const [cars, setCars] = useState<SavedCar[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    let live = true;
    void (async () => {
      let list: SavedCar[];
      try {
        list = (await apiGet<{ cars: SavedCar[] }>("/api/me/cars")).cars;
      } catch {
        if (live) setCars([]);
        return;
      }
      const guest = localCar();
      if (guest && list.length < MAX_CARS && !list.some((c) => sameCar(c, guest))) {
        try {
          const { car } = await apiPost<{ car: SavedCar }>("/api/me/cars", guest);
          list = [...list, car];
          rememberCarId(car.id);
          keepLocalCar(null);
        } catch {
          // Kept on the phone; tried again next time.
        }
      } else if (guest && list.some((c) => sameCar(c, guest))) {
        keepLocalCar(null);
      }
      if (live) setCars(list);
    })();
    return () => {
      live = false;
    };
  }, [enabled]);
  return [cars, setCars];
}
