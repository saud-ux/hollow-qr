import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef } from "react";
import { tr } from "../lib/i18n";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A map the customer drags under a fixed pin, like ride-hailing apps: the
 * point under the pin is the place. OpenStreetMap tiles; code-split so only
 * the place editor loads Leaflet.
 */
export default function MapPicker({ center, onMove, recenter }: { center: LatLng; onMove: (point: LatLng) => void; recenter: number }) {
  const box = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const moved = useRef(onMove);
  useEffect(() => {
    moved.current = onMove;
  });

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], 17);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(m);
    m.attributionControl.setPrefix(false);
    m.on("moveend", () => {
      const c = m.getCenter();
      moved.current({ lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) });
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; later centres arrive through `recenter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // "My location" (or the first fix) moves the map; dragging does not come back here.
  useEffect(() => {
    if (recenter > 0) map.current?.setView([center.lat, center.lng], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  return (
    <div className="map-picker">
      <div ref={box} className="map-picker__map" role="application" aria-label={tr("الخريطة: حرّكها لين يصير الدبوس على مكانك", "Map: move it until the pin is on your place")} />
      <svg className="map-picker__pin" width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" stroke="#2b1e16" strokeWidth="0.8" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
      </svg>
      <span className="map-picker__shadow" aria-hidden="true" />
    </div>
  );
}
