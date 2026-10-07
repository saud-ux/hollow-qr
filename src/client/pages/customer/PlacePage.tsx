import { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router";
import type { PlaceKind, SavedPlace } from "../../../shared/types";
import { AccountIcon } from "../../components/AccountIcons";
import { BackButton } from "../../components/BackButton";
import { CustomerLayout } from "../../components/CustomerLayout";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import type { LatLng } from "../../components/MapPicker";
import { TabBar } from "../../components/Shop";
import { apiDelete, apiPost, apiSend, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { currentLang, tr } from "../../lib/i18n";
import { placeName, usePlaces } from "../../lib/places";

const MapPicker = lazy(() => import("../../components/MapPicker"));

/** Al Zulfi, where the café is: the map's starting point when the phone can't say where it is. */
const ZULFI: LatLng = { lat: 26.2994, lng: 44.8155 };

const KINDS: PlaceKind[] = ["home", "work", "other"];

/** Best effort: the district and street under the pin, to start the address with. */
async function streetAt(point: LatLng, signal: AbortSignal): Promise<string | null> {
  const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&lat=${point.lat}&lon=${point.lng}&accept-language=${currentLang()}`;
  const res = await fetch(url, { signal });
  if (!res.ok) return null;
  const a = ((await res.json()) as { address?: Record<string, string> }).address ?? {};
  const parts = [a.neighbourhood ?? a.suburb ?? a.quarter, a.road].filter(Boolean);
  return parts.length ? parts.join(currentLang() === "en" ? ", " : "، ") : null;
}

function locate(): Promise<LatLng | null> {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) return resolve(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) }),
      () => resolve(null),
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  });
}

/** Account → My places: add or edit a place on the map. */
export function PlacePage() {
  const { id } = useParams();
  const { session, loading } = useAuth();
  const places = usePlaces(!!session);
  const isNew = !id || id === "new";
  if (!loading && !session) return <Navigate to="/login" replace />;
  if (isNew) return <PlaceForm existing={null} />;
  if (!places) {
    return (
      <CustomerLayout dock={<TabBar />}>
        <Spinner />
      </CustomerLayout>
    );
  }
  const existing = places.find((p) => p.id === id);
  if (!existing) return <Navigate to="/account" replace />;
  return <PlaceForm key={existing.id} existing={existing} />;
}

function PlaceForm({ existing }: { existing: SavedPlace | null }) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const isNew = existing === null;
  const back = params.get("back");
  const start: LatLng = existing ? { lat: existing.lat, lng: existing.lng } : ZULFI;

  const [kind, setKind] = useState<PlaceKind>(() => {
    if (existing) return existing.kind;
    const k = params.get("kind");
    return k === "home" || k === "work" || k === "other" ? k : "home";
  });
  const [label, setLabel] = useState(existing?.label ?? "");
  const [address, setAddress] = useState(existing?.address ?? "");
  const [details, setDetails] = useState(existing?.details ?? "");
  const [point, setPoint] = useState<LatLng>(start);
  const [center, setCenter] = useState<LatLng>(start);
  const [recenter, setRecenter] = useState(0);
  const [locating, setLocating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  // A saved address is the customer's own words: never replace it with a suggestion.
  const addressTouched = useRef(!isNew);

  // A new place starts where the phone is.
  useEffect(() => {
    if (!isNew) return;
    void locate().then((here) => {
      if (!here) return;
      setCenter(here);
      setPoint(here);
      setRecenter((n) => n + 1);
    });
  }, [isNew]);

  // Suggest the street under the pin until the customer types their own.
  useEffect(() => {
    if (addressTouched.current) return;
    const ctrl = new AbortController();
    const timer = window.setTimeout(() => {
      streetAt(point, ctrl.signal)
        .then((street) => {
          if (street && !addressTouched.current) setAddress(street);
        })
        .catch(() => undefined);
    }, 700);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
  }, [point]);

  async function locateMe() {
    setLocating(true);
    setError(null);
    const here = await locate();
    setLocating(false);
    if (!here) {
      setError(tr("تعذّر تحديد موقعك. حرّك الخريطة لين يصير الدبوس على مكانك", "Couldn't find your location. Move the map until the pin is on your place"));
      return;
    }
    setCenter(here);
    setPoint(here);
    setRecenter((n) => n + 1);
  }

  function done() {
    if (back?.startsWith("/")) void navigate(back, { replace: true });
    else void navigate("/account", { replace: true });
  }

  async function save() {
    setBusy(true);
    setError(null);
    const body = { kind, label: kind === "other" ? label : null, address, details: details || null, lat: point.lat, lng: point.lng };
    try {
      if (existing) await apiSend("PUT", `/api/me/places/${existing.id}`, body);
      else await apiPost("/api/me/places", body);
      done();
    } catch (err) {
      setError(errorText(err));
      setBusy(false);
    }
  }

  async function remove() {
    if (!existing) return;
    setBusy(true);
    try {
      await apiDelete(`/api/me/places/${existing.id}`);
      void navigate("/account", { replace: true });
    } catch (err) {
      setDeleteOpen(false);
      setError(errorText(err));
      setBusy(false);
    }
  }

  const ready = address.trim().length > 0 && (kind !== "other" || label.trim().length > 0);

  return (
    <CustomerLayout dock={<TabBar />}>
      <BackButton fallback={back ?? "/account"} />
      <h1 className="page-title">{isNew ? tr("إضافة عنوان", "Add a place") : placeName({ kind, label: label || null })}</h1>

      <div className="place-kinds" role="radiogroup" aria-label={tr("نوع العنوان", "Place type")}>
        {KINDS.map((k) => (
          <button key={k} type="button" role="radio" aria-checked={kind === k} className={`place-kind ${kind === k ? "is-on" : ""}`} onClick={() => setKind(k)}>
            <AccountIcon name={k === "home" ? "home" : k === "work" ? "work" : "pin"} className="place-kind__icon" />
            {k === "other" ? tr("غيره", "Other") : placeName({ kind: k, label: null })}
          </button>
        ))}
      </div>

      {kind === "other" && (
        <div className="field">
          <label htmlFor="place-label">{tr("اسم العنوان", "Name")}</label>
          <input id="place-label" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={30} placeholder={tr("مثل: بيت أهلي", "e.g. Parents' house")} />
        </div>
      )}

      <div className="place-map">
        <Suspense
          fallback={
            <div className="map-picker map-picker--loading">
              <Spinner />
            </div>
          }
        >
          <MapPicker center={center} recenter={recenter} onMove={setPoint} />
        </Suspense>
        <p className="muted small">{tr("حرّك الخريطة لين يصير الدبوس على الباب بالضبط.", "Move the map until the pin is right on the door.")}</p>
        <button type="button" className="btn btn--ghost place-locate" onClick={() => void locateMe()} disabled={locating}>
          <AccountIcon name="pin" className="place-locate__icon" />
          {locating ? tr("نحدد موقعك…", "Finding you…") : tr("حدّد موقعي الحالي", "Use my current location")}
        </button>
      </div>

      <div className="field">
        <label htmlFor="place-address">{tr("العنوان", "Address")}</label>
        <input
          id="place-address"
          value={address}
          onChange={(e) => {
            addressTouched.current = true;
            setAddress(e.target.value);
          }}
          maxLength={300}
          placeholder={tr("الحي والشارع", "District and street")}
        />
      </div>
      <div className="field">
        <label htmlFor="place-details">{tr("تفاصيل تساعد المندوب", "Details for the driver")}</label>
        <input id="place-details" value={details} onChange={(e) => setDetails(e.target.value)} maxLength={200} placeholder={tr("مثل: بيت بباب أسود، الدور الثاني", "e.g. Black door, second floor")} />
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="place-actions">
        <button type="button" className="btn btn--primary btn--block" onClick={() => void save()} disabled={!ready || busy}>
          {busy ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ", "Save")}
        </button>
        {!isNew && (
          <button type="button" className="btn btn--ghost btn--block place-delete" onClick={() => setDeleteOpen(true)} disabled={busy}>
            {tr("حذف هذا العنوان", "Delete this place")}
          </button>
        )}
      </div>

      <ConfirmDialog
        open={deleteOpen}
        title={tr("حذف العنوان؟", "Delete this place?")}
        confirmLabel={tr("احذف", "Delete")}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setDeleteOpen(false)}
      />
    </CustomerLayout>
  );
}
