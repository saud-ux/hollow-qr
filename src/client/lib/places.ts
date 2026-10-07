import { useEffect, useState } from "react";
import type { PlaceKind, SavedPlace } from "../../shared/types";
import { apiGet } from "./api";
import { tr } from "./i18n";

/** What a saved place is called: home and work by the app, others by the customer. */
export function placeName(place: Pick<SavedPlace, "kind" | "label">): string {
  if (place.kind === "home") return tr("البيت", "Home");
  if (place.kind === "work") return tr("الدوام", "Work");
  return place.label ?? tr("عنوان", "Place");
}

export const placeIcon = (kind: PlaceKind) => (kind === "home" ? "home" : kind === "work" ? "work" : "pin");

/** The address as the driver reads it: the address, then the details. */
export function placeAddress(place: Pick<SavedPlace, "address" | "details">): string {
  return place.details ? `${place.address} — ${place.details}` : place.address;
}

/** The signed-in customer's saved places (null while loading). */
export function usePlaces(enabled: boolean): SavedPlace[] | null {
  const [places, setPlaces] = useState<SavedPlace[] | null>(null);
  useEffect(() => {
    if (!enabled) return;
    apiGet<{ places: SavedPlace[] }>("/api/me/places")
      .then((r) => setPlaces(r.places))
      .catch(() => setPlaces([]));
  }, [enabled]);
  return places;
}
