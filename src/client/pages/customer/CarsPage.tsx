import { useState } from "react";
import { Navigate } from "react-router";
import { carColorName, carNameText, MAX_CARS, type CarDetails, type SavedCar } from "../../../shared/cars";
import { BackButton } from "../../components/BackButton";
import { TentArt } from "../../components/Brand";
import { CarPlate, CarSwatch } from "../../components/CarPlate";
import { CarSheet } from "../../components/CarSheet";
import { CustomerLayout } from "../../components/CustomerLayout";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { TabBar } from "../../components/Shop";
import { apiDelete, apiPost, apiSend, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useCars } from "../../lib/cars";
import { currentLang, tr } from "../../lib/i18n";

/** Account → My cars: the cars offered at checkout for curbside pickup. */
export function CarsPage() {
  const { session, loading } = useAuth();
  const [cars, setCars] = useCars(!!session);
  const [editing, setEditing] = useState<SavedCar | "new" | null>(null);
  const [removing, setRemoving] = useState<SavedCar | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const en = currentLang() === "en";

  if (!loading && !session) return <Navigate to="/login" replace />;

  async function save(car: CarDetails) {
    if (editing === "new") {
      const { car: saved } = await apiPost<{ car: SavedCar }>("/api/me/cars", car);
      setCars([...(cars ?? []), saved]);
    } else if (editing) {
      const { car: saved } = await apiSend<{ car: SavedCar }>("PUT", `/api/me/cars/${editing.id}`, car);
      setCars((cars ?? []).map((c) => (c.id === saved.id ? saved : c)));
    }
  }

  async function remove() {
    if (!removing) return;
    setBusy(true);
    setError(null);
    try {
      await apiDelete(`/api/me/cars/${removing.id}`);
      setCars((cars ?? []).filter((c) => c.id !== removing.id));
      setRemoving(null);
    } catch (err) {
      setRemoving(null);
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <CustomerLayout dock={<TabBar />}>
      <BackButton fallback="/account" />
      <h1 className="page-title">{tr("سياراتي", "My cars")}</h1>
      {error && <Alert tone="error">{error}</Alert>}

      {cars === null ? (
        <Spinner />
      ) : cars.length === 0 ? (
        <div className="cars-empty">
          <TentArt className="cars-empty__art" />
          <strong>{tr("ما أضفت سيارة للحين", "No cars yet")}</strong>
          <span className="muted">{tr("أضف سيارتك مرة وحدة، وتختارها بضغطة كل ما طلبت من السيارة.", "Add your car once, then pick it with a tap whenever you order curbside.")}</span>
        </div>
      ) : (
        <ul className="car-cards">
          {cars.map((car) => (
            <li key={car.id} className="car-card">
              <div className="car-card__main">
                <CarSwatch color={car.color} />
                <span className="car-card__text">
                  <strong>{carNameText(car.name, en)}</strong>
                  <small>{carColorName(car, en)}</small>
                </span>
                {car.plateLetters && car.plateNumbers ? (
                  <CarPlate letters={car.plateLetters} numbers={car.plateNumbers} size="md" />
                ) : (
                  <small className="car-option__no-plate">{tr("بدون لوحة", "No plate")}</small>
                )}
              </div>
              <div className="car-card__actions">
                <button type="button" onClick={() => setEditing(car)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" />
                  </svg>
                  {tr("تعديل", "Edit")}
                </button>
                <button type="button" className="car-card__delete" onClick={() => setRemoving(car)}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" />
                  </svg>
                  {tr("حذف", "Delete")}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {cars !== null && cars.length < MAX_CARS && (
        <button type="button" className="btn btn--secondary btn--block" onClick={() => setEditing("new")}>
          {tr("+ إضافة سيارة", "+ Add a car")}
        </button>
      )}

      {editing && (
        <CarSheet
          car={editing === "new" ? null : editing}
          title={editing === "new" ? tr("سيارة جديدة", "New car") : tr("تعديل السيارة", "Edit car")}
          saveLabel={editing === "new" ? tr("إضافة السيارة", "Add car") : tr("حفظ التعديل", "Save changes")}
          onSave={save}
          onClose={() => setEditing(null)}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={tr("حذف السيارة؟", "Delete this car?")}
        confirmLabel={tr("احذف", "Delete")}
        tone="danger"
        busy={busy}
        onConfirm={() => void remove()}
        onCancel={() => setRemoving(null)}
      />
    </CustomerLayout>
  );
}
