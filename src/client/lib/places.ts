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

/** HOLLOW's door, the same point the iOS nearby alerts use (HollowGeofencePlugin.swift). */
export const HOLLOW_SPOT = { lat: 26.303045, lng: 44.832762 } as const;

/** Straight-line distance in kilometres (haversine). */
export function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** «يبعد 1.4 كم عن هولو», or «قريب من هولو» within a few hundred metres. */
export function distanceFromHollow(point: { lat: number; lng: number }): string {
  const km = kmBetween(point, HOLLOW_SPOT);
  if (km < 0.3) return tr("قريب جدًا من هولو", "Right by HOLLOW");
  const shown = km < 10 ? km.toFixed(1) : String(Math.round(km));
  return tr(`يبعد ${shown} كم عن هولو`, `${shown} km from HOLLOW`);
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
