import "leaflet/dist/leaflet.css";
import L from "leaflet";
import { useEffect, useRef, useState } from "react";
import { tr } from "../lib/i18n";
import { play } from "../lib/motion";
import { tapFeedback } from "../lib/native";

export interface LatLng {
  lat: number;
  lng: number;
}

/**
 * A map the customer drags under a fixed pin, like ride-hailing apps: the
 * point under the pin is the place. While the map moves the pin lifts off it
 * (its shadow shrinks, a hint shows above); when it stops the pin drops back
 * with a small bounce, a gold ring and a tap you can feel. Street map
 * (OpenStreetMap) or satellite photos (Esri), switched from the corner and
 * remembered on this device; code-split so only the place editor loads Leaflet.
 */
type Layer = "map" | "satellite";
const LAYER_KEY = "hollow.mapLayer";

function savedLayer(): Layer {
  try {
    return localStorage.getItem(LAYER_KEY) === "satellite" ? "satellite" : "map";
  } catch {
    return "map";
  }
}

function tiles(layer: Layer): L.TileLayer {
  return layer === "satellite"
    ? L.tileLayer("https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}", {
        maxZoom: 19,
        maxNativeZoom: 17,
        attribution: "© Esri, Maxar",
      })
    : L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        attribution: "© OpenStreetMap",
      });
}

export default function MapPicker({ center, onMove, recenter }: { center: LatLng; onMove: (point: LatLng) => void; recenter: number }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLDivElement>(null);
  const pin = useRef<SVGSVGElement>(null);
  const ring = useRef<HTMLSpanElement>(null);
  const map = useRef<L.Map | null>(null);
  const [layer, setLayer] = useState(savedLayer);
  const moved = useRef(onMove);
  useEffect(() => {
    moved.current = onMove;
  });

  useEffect(() => {
    if (!box.current) return;
    const m = L.map(box.current, { zoomControl: false, attributionControl: true }).setView([center.lat, center.lng], 17);
    m.attributionControl.setPrefix(false);
    let lifted = false;
    m.on("movestart", () => {
      lifted = true;
      frame.current?.classList.add("is-up");
    });
    m.on("moveend", () => {
      const c = m.getCenter();
      moved.current({ lat: Number(c.lat.toFixed(6)), lng: Number(c.lng.toFixed(6)) });
      if (!lifted) return;
      lifted = false;
      frame.current?.classList.remove("is-up");
      void play(
        pin.current,
        [
          { transform: "translate(-50%, calc(-100% - 16px)) scale(1.06)" },
          { transform: "translate(-50%, calc(-100% + 2px)) scale(1.02, .94)", offset: 0.55 },
          { transform: "translate(-50%, calc(-100% - 5px))", offset: 0.78 },
          { transform: "translate(-50%, -100%)" },
        ],
        { duration: 460, easing: "ease-out" },
      );
      void play(ring.current, [{ opacity: 0.9, transform: "translate(-50%, -50%) scale(.4)" }, { opacity: 0, transform: "translate(-50%, -50%) scale(1.8)" }], {
        duration: 650,
        delay: 200,
        easing: "ease-out",
      });
      tapFeedback();
    });
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
    };
    // The map is created once; later centres arrive through `recenter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const m = map.current;
    if (!m) return;
    const t = tiles(layer).addTo(m);
    return () => {
      t.remove();
    };
  }, [layer]);

  const switchLayer = (next: Layer) => {
    if (next === layer) return;
    setLayer(next);
    tapFeedback();
    try {
      localStorage.setItem(LAYER_KEY, next);
    } catch {
      // Not remembered, but the switch still works.
    }
  };

  // "My location" (or the first fix) moves the map; dragging does not come back here.
  useEffect(() => {
    if (recenter > 0) map.current?.setView([center.lat, center.lng], 17);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recenter]);

  return (
    <div ref={frame} className={`map-picker${layer === "satellite" ? " map-picker--satellite" : ""}`}>
      <div ref={box} className="map-picker__map" role="application" aria-label={tr("الخريطة: حرّكها لين يصير الدبوس على مكانك", "Map: move it until the pin is on your place")} />
      <span className="map-picker__hint" aria-hidden="true">
        {tr("اترك الدبوس على الباب", "Drop the pin on the door")}
      </span>
      <span ref={ring} className="map-picker__ring" aria-hidden="true" />
      <svg ref={pin} className="map-picker__pin" width="40" height="40" viewBox="0 0 24 24" aria-hidden="true">
        <path fill="currentColor" stroke="#2b1e16" strokeWidth="0.8" d="M12 2a7 7 0 0 0-7 7c0 5 7 13 7 13s7-8 7-13a7 7 0 0 0-7-7Zm0 9.5a2.5 2.5 0 1 1 0-5 2.5 2.5 0 0 1 0 5Z" />
      </svg>
      <span className="map-picker__shadow" aria-hidden="true" />
      <div className="map-picker__layers" role="group" aria-label={tr("نوع الخريطة", "Map type")}>
        {(
          [
            ["map", tr("خريطة", "Map")],
            ["satellite", tr("قمر صناعي", "Satellite")],
          ] as const
        ).map(([key, label]) => (
          <button key={key} type="button" className="map-picker__layer" aria-pressed={layer === key} onClick={() => switchLayer(key)}>
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
