import { useEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  FULFILLMENT_LABELS_AR,
  isOrderable,
  normalizeSaudiPhone,
  type FulfillmentType,
  type MenuItem,
  type Order,
  type PlaceOrderRequest,
} from "../../../shared/ordering";
import { Alert, Field, Spinner } from "../../components/Field";
import { CarIcon, ItemImage, QtyStepper, ScooterIcon, ShopLayout, StoreIcon } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { enablePush, successFeedback } from "../../lib/native";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { newIdempotencyKey } from "../../lib/hooks";
import { riyals, useMenu } from "../../lib/menu";
import { withNext } from "../../lib/next";
import { closedNote } from "./hours";

const PHONE_KEY = "hollow.phone";
const CAR_KEY = "hollow.car";
const ADDRESS_KEY = "hollow.address";

function remembered(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
function remember(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // storage blocked: nothing to remember
  }
}

const FULFILLMENT_ICONS: Record<FulfillmentType, () => React.JSX.Element> = {
  pickup: StoreIcon,
  curbside: CarIcon,
  delivery: ScooterIcon,
};

type Coords = { lat: number; lng: number };

export function CartPage() {
  const { session, me } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const { menu, error: menuError, reload } = useMenu();
  const [chosen, setFulfillment] = useState<FulfillmentType>("pickup");
  const [phone, setPhone] = useState(() => remembered(PHONE_KEY));
  const [car, setCar] = useState(() => remembered(CAR_KEY));
  const [address, setAddress] = useState(() => remembered(ADDRESS_KEY));
  const [coords, setCoords] = useState<Coords | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [useReward, setUseReward] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // One key per checkout attempt: a retry after a network error replays it.
  const idempotencyKey = useRef(newIdempotencyKey());

  const card = me?.card ?? null;
  const rewardAvailable = Boolean(card?.rewardAvailable && card.membershipStatus === "active");

  const lines = !menu
    ? []
    : cart.lines
        .map((l) => ({ line: l, item: menu.items.find((i) => i.id === l.menuItemId) }))
        .filter((x): x is { line: (typeof cart.lines)[number]; item: MenuItem } => Boolean(x.item));

  // Drop lines whose item left the menu (archived) once the menu is known.
  useEffect(() => {
    if (!menu) return;
    for (const l of cart.lines) {
      if (!menu.items.some((i) => i.id === l.menuItemId)) cart.remove(l.menuItemId, l.optionId);
    }
  }, [menu, cart]);

  const settings = menu?.shop.settings;
  const options = (["pickup", "curbside", "delivery"] as FulfillmentType[]).filter((f) =>
    !settings ? true : f === "pickup" ? settings.pickupEnabled : f === "curbside" ? settings.curbsideEnabled : settings.deliveryEnabled,
  );
  // Fall back to the first enabled option if the admin turned one off.
  const fulfillment: FulfillmentType = options.includes(chosen) ? chosen : (options[0] ?? "pickup");

  const subtotal = lines.reduce((s, { line, item }) => s + item.priceHalalas * line.quantity, 0);
  const drinks = lines.filter(({ item }) => item.category === "drink");
  const rewardApplies = rewardAvailable && useReward && drinks.length > 0;
  const discount = rewardApplies ? Math.max(...drinks.map(({ item }) => item.priceHalalas)) : 0;
  const fee = fulfillment === "delivery" ? (settings?.deliveryFeeHalalas ?? 0) : 0;
  const total = subtotal + fee - discount;
  // A line can't be ordered when the item is off, or its origin is missing or out of stock.
  const lineProblem = ({ line, item }: (typeof lines)[number]): "soldout" | "choose" | "option-out" | null => {
    if (!isOrderable(item)) return "soldout";
    if (item.options.length === 0) return null;
    const option = item.options.find((o) => o.id === line.optionId);
    if (!option) return "choose";
    return option.isAvailable ? null : "option-out";
  };
  const unavailable = lines.filter((l) => lineProblem(l) !== null);
  const belowMinimum = fulfillment === "delivery" && settings ? subtotal < settings.deliveryMinOrderHalalas : false;

  function locate() {
    if (!("geolocation" in navigator)) {
      setLocError("المتصفح لا يدعم تحديد الموقع");
      return;
    }
    setLocating(true);
    setLocError(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: Number(pos.coords.latitude.toFixed(6)), lng: Number(pos.coords.longitude.toFixed(6)) });
        setLocating(false);
      },
      () => {
        setLocError("تعذّر تحديد موقعك. اكتب العنوان بالتفصيل");
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalizedPhone = normalizeSaudiPhone(phone);
    const next: Record<string, string | null> = {
      phone: normalizedPhone ? null : "اكتب رقم جوال صحيح (مثال: 0512345678)",
      car: fulfillment === "curbside" && !car.trim() ? "اكتب نوع السيارة ولونها" : null,
      address: fulfillment === "delivery" && !address.trim() ? "اكتب عنوان التوصيل" : null,
    };
    setErrors(next);
    setFormError(null);
    if (Object.values(next).some(Boolean)) return;

    const body: PlaceOrderRequest = {
      items: lines.map(({ line }) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        note: line.note.trim() || undefined,
        optionId: line.optionId ?? undefined,
      })),
      fulfillment,
      phone: normalizedPhone!,
      carDescription: fulfillment === "curbside" ? car.trim() : undefined,
      deliveryAddress: fulfillment === "delivery" ? address.trim() : undefined,
      deliveryLat: fulfillment === "delivery" ? coords?.lat : undefined,
      deliveryLng: fulfillment === "delivery" ? coords?.lng : undefined,
      note: note.trim() || undefined,
      useReward: rewardApplies,
      idempotencyKey: idempotencyKey.current,
    };
    setBusy(true);
    try {
      const { order } = await apiPost<{ order: Order }>("/api/orders", body);
      remember(PHONE_KEY, normalizedPhone!);
      if (fulfillment === "curbside") remember(CAR_KEY, car.trim());
      if (fulfillment === "delivery") remember(ADDRESS_KEY, address.trim());
      cart.clear();
      successFeedback();
      // iOS app: ask for notifications right after the first order, when
      // "we'll tell you when it's ready" makes sense.
      void enablePush().catch(() => undefined);
      void navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      // A rejected order is final for this key; a new attempt gets a new one.
      if (err instanceof ApiClientError && err.status !== 0) idempotencyKey.current = newIdempotencyKey();
      if (err instanceof ApiClientError && (err.code === "ITEM_UNAVAILABLE" || err.code === "SHOP_CLOSED")) void reload();
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!menu) {
    return (
      <ShopLayout>
        <h1 className="page-title">السلة</h1>
        {menuError ? <Alert tone="error">{menuError}</Alert> : <Spinner />}
      </ShopLayout>
    );
  }

  if (lines.length === 0) {
    return (
      <ShopLayout>
        <h1 className="page-title">السلة</h1>
        <div className="empty">
          <img src="/brand/tent-espresso.png" alt="" className="empty__art" />
          <h2 className="empty__title">سلتك فارغة</h2>
          <p className="empty__sub">اختر مشروبك من المنيو ونجهّزه لك.</p>
          <Link to="/menu" className="btn btn--primary">
            تصفّح المنيو
          </Link>
        </div>
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <h1 className="page-title">السلة</h1>
      {!menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>لا نستقبل طلبات الآن</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}

      <form className="checkout" onSubmit={submit} noValidate>
        <section className="sheet" aria-labelledby="cart-items">
          <h2 id="cart-items" className="pass-label">
            طلبك
          </h2>
          <ul className="cart-lines">
            {lines.map((entry) => {
              const { line, item } = entry;
              const key = `${line.menuItemId}|${line.optionId ?? ""}`;
              const problem = lineProblem(entry);
              return (
                <li key={key} className={`cart-line ${problem === "soldout" ? "cart-line--soldout" : ""}`}>
                  <ItemImage item={item} className="cart-line__img" />
                  <div className="cart-line__body">
                    <div className="cart-line__top">
                      <span className="cart-line__name">{item.nameAr}</span>
                      <span className="cart-line__price">{riyals(item.priceHalalas * line.quantity)}</span>
                    </div>
                    {item.options.length > 0 && (
                      <div className="cart-origins" role="radiogroup" aria-label={item.optionLabel ?? "النوع"}>
                        {item.options.map((o) => (
                          <button
                            key={o.id}
                            type="button"
                            role="radio"
                            aria-checked={line.optionId === o.id}
                            className={`cart-origin ${line.optionId === o.id ? "is-on" : ""}`}
                            disabled={!o.isAvailable}
                            onClick={() => cart.setOption(item.id, line.optionId, o.id)}
                          >
                            {o.nameAr}
                          </button>
                        ))}
                      </div>
                    )}
                    {problem === "soldout" && <span className="badge badge--danger">نفد، احذفه من السلة</span>}
                    {problem === "choose" && <span className="badge badge--warning">اختر {item.optionLabel ?? "النوع"}</span>}
                    {problem === "option-out" && <span className="badge badge--danger">هذا المحصول نفد، اختر غيره</span>}
                    <div className="cart-line__actions">
                      <QtyStepper
                        quantity={line.quantity}
                        onChange={(q) => cart.setQuantity(item.id, q, line.optionId)}
                        label={item.nameAr}
                      />
                      {!openNotes.has(key) && !line.note ? (
                        <button type="button" className="link-btn" onClick={() => setOpenNotes(new Set(openNotes).add(key))}>
                          إضافة ملاحظة
                        </button>
                      ) : null}
                    </div>
                    {(openNotes.has(key) || line.note) && (
                      <input
                        className="note-input"
                        value={line.note}
                        onChange={(e) => cart.setNote(item.id, e.target.value, line.optionId)}
                        placeholder="مثال: بدون سكر، ثلج قليل"
                        maxLength={120}
                        aria-label={`ملاحظة على ${item.nameAr}`}
                      />
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
          <Link to="/menu" className="link-btn">
            + إضافة أصناف
          </Link>
        </section>

        {rewardAvailable && (
          <section className="sheet sheet--dark">
            <label className="reward-toggle">
              <input type="checkbox" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} />
              <span>
                <strong>استخدم مشروبك المجاني</strong>
                <small>
                  {drinks.length === 0
                    ? "أضف مشروبًا لاستخدام المكافأة"
                    : useReward
                      ? `نخصم ${riyals(discount)} (أغلى مشروب في طلبك)`
                      : "بطاقتك ممتلئة: استخدم المكافأة لتبدأ جمع أكواب جديدة"}
                </small>
              </span>
            </label>
          </section>
        )}

        <section className="sheet" aria-labelledby="fulfillment">
          <h2 id="fulfillment" className="pass-label">
            طريقة الاستلام
          </h2>
          <div className="choice-grid" role="radiogroup" aria-labelledby="fulfillment">
            {options.map((f) => {
              const Icon = FULFILLMENT_ICONS[f];
              return (
                <label key={f} className={`choice ${fulfillment === f ? "choice--on" : ""}`}>
                  <input type="radio" name="fulfillment" value={f} checked={fulfillment === f} onChange={() => setFulfillment(f)} />
                  <Icon />
                  <span>{FULFILLMENT_LABELS_AR[f]}</span>
                  {f === "delivery" && settings && <small>{riyals(settings.deliveryFeeHalalas)}</small>}
                </label>
              );
            })}
          </div>
          {fulfillment === "curbside" && (
            <Field
              label="السيارة"
              value={car}
              onChange={(e) => setCar(e.target.value)}
              placeholder="مثال: كامري بيضاء"
              hint="نطلع لك الطلب عند السيارة. اضغط «وصلت» من صفحة الطلب عند وصولك"
              maxLength={80}
              error={errors.car}
            />
          )}
          {fulfillment === "delivery" && (
            <div className="delivery-fields">
              <div className={`field ${errors.address ? "field--error" : ""}`}>
                <label htmlFor="address">عنوان التوصيل</label>
                <textarea
                  id="address"
                  rows={3}
                  value={address}
                  onChange={(e) => setAddress(e.target.value)}
                  placeholder="الحي، الشارع، رقم البيت، وأي وصف يساعد المندوب"
                  maxLength={300}
                  aria-invalid={Boolean(errors.address)}
                />
                {errors.address && (
                  <small className="field__error" role="alert">
                    {errors.address}
                  </small>
                )}
              </div>
              <button type="button" className={`btn btn--small ${coords ? "btn--secondary" : "btn--ghost"}`} onClick={locate} disabled={locating}>
                {locating ? "جارٍ تحديد الموقع…" : coords ? "تم تحديد موقعك ✓" : "حدّد موقعي على الخريطة"}
              </button>
              {locError && <small className="field__error">{locError}</small>}
              {belowMinimum && settings && (
                <Alert tone="warning">الحد الأدنى لطلبات التوصيل {riyals(settings.deliveryMinOrderHalalas)}</Alert>
              )}
            </div>
          )}
        </section>

        <section className="sheet" aria-labelledby="contact">
          <h2 id="contact" className="pass-label">
            التواصل
          </h2>
          <Field
            label="رقم الجوال"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="05XXXXXXXX"
            error={errors.phone}
          />
          <div className="field">
            <label htmlFor="order-note">ملاحظة على الطلب (اختياري)</label>
            <textarea id="order-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
        </section>

        <section className="sheet summary" aria-label="ملخص الطلب">
          <div className="summary__row">
            <span>المجموع</span>
            <span>{riyals(subtotal)}</span>
          </div>
          {fee > 0 && (
            <div className="summary__row">
              <span>التوصيل</span>
              <span>{riyals(fee)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="summary__row summary__row--reward">
              <span>المشروب المجاني</span>
              <span>− {riyals(discount)}</span>
            </div>
          )}
          <div className="summary__row summary__row--total">
            <span>الإجمالي</span>
            <span>{riyals(total)}</span>
          </div>
          <p className="summary__pay">الدفع عند الاستلام</p>
        </section>

        {formError && <Alert tone="error">{formError}</Alert>}
        {session ? (
          <div className="checkout__submit">
            <button
              type="submit"
              className="btn btn--primary btn--block btn--lg"
              disabled={busy || !menu.shop.isOpen || unavailable.length > 0 || belowMinimum}
            >
              {busy ? "جارٍ إرسال الطلب…" : `تأكيد الطلب · ${riyals(total)}`}
            </button>
          </div>
        ) : (
          <div className="signin-cta">
            <p>سجّل الدخول لإكمال الطلب وجمع أكوابك</p>
            <Link to={withNext("/login", "/cart")} className="btn btn--primary btn--block btn--lg">
              تسجيل الدخول
            </Link>
            <Link to={withNext("/register", "/cart")} className="btn btn--secondary btn--block">
              إنشاء حساب جديد
            </Link>
          </div>
        )}
      </form>
    </ShopLayout>
  );
}
