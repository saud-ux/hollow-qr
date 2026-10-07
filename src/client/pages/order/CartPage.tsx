import { useEffect, useLayoutEffect, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import {
  isOrderable,
  MAX_LINE_QUANTITY,
  normalizeSaudiPhone,
  priceOf,
  type FulfillmentType,
  type MenuItem,
  type Order,
  type PlaceOrderRequest,
} from "../../../shared/ordering";
import { Alert, Field } from "../../components/Field";
import { showToast } from "../../components/Toast";
import { inCart, stockLeftText, stockRoom } from "../../lib/stock";
import { CartSkeleton } from "../../components/Skeletons";
import { CarIcon, ItemImage, QtyStepper, ScooterIcon, ShopLayout, StoreIcon } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { enablePush, successFeedback } from "../../lib/native";
import { CALM, motionOn, play } from "../../lib/motion";
import { Rolling } from "../../components/Rolling";
import { SalePrice } from "../../components/SalePrice";
import { SwipeToDelete } from "../../components/SwipeToDelete";
import { useAuth } from "../../lib/auth";
import { useCart } from "../../lib/cart";
import { newIdempotencyKey } from "../../lib/hooks";
import { riyals, useMenu } from "../../lib/menu";
import { withNext } from "../../lib/next";
import { fulfillmentLabel, itemName, optionLabel, optionName } from "../../lib/menuText";
import { closedNote } from "./hours";
import { MAX_PLACES } from "../../../shared/types";
import { AccountIcon } from "../../components/AccountIcons";
import { placeAddress, placeIcon, placeName, usePlaces } from "../../lib/places";
import { tr } from "../../lib/i18n";

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
  const places = usePlaces(!!session);
  const [placeId, setPlaceId] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);
  const [locError, setLocError] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [openNotes, setOpenNotes] = useState<Set<string>>(new Set());
  const [useReward, setUseReward] = useState(true);
  const [errors, setErrors] = useState<Record<string, string | null>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [placed, setPlaced] = useState(false);
  const submitRef = useRef<HTMLButtonElement>(null);
  useLayoutEffect(() => {
    const el = submitRef.current;
    if (!placed || !el) return;
    void play(el, [{ width: `${el.getBoundingClientRect().width}px` }, { width: "58px" }], { duration: 320, easing: CALM.easing, fill: "forwards" });
    void play(el.querySelector("path"), [{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 380, easing: "ease-out", delay: 200, fill: "both" });
  }, [placed]);
  // One key per checkout attempt: a retry after a network error replays it.
  const idempotencyKey = useRef(newIdempotencyKey());

  const card = me?.card ?? null;
  const rewardAvailable = Boolean(card?.rewardAvailable && card.membershipStatus === "active");

  const lines = !menu
    ? []
    : cart.lines
        .map((l) => ({ line: l, item: menu.items.find((i) => i.id === l.menuItemId) }))
        .filter((x): x is { line: (typeof cart.lines)[number]; item: MenuItem } => Boolean(x.item));

  // iOS app: ask for notifications as soon as there is something in the cart,
  // so the phone is registered before the order and "we got your order"
  // arrives for the very first one. iOS shows its prompt only once.
  const hasLines = lines.length > 0;
  useEffect(() => {
    if (hasLines) void enablePush().catch(() => undefined);
  }, [hasLines]);

  // Drop lines whose item left the menu (archived) once the menu is known.
  useEffect(() => {
    if (!menu) return;
    for (const l of cart.lines) {
      if (!menu.items.some((i) => i.id === l.menuItemId)) cart.remove(l.menuItemId, l.optionId);
    }
  }, [menu, cart]);

  const settings = menu?.shop.settings;
  const isEnabled = (f: FulfillmentType) =>
    !settings ? true : f === "pickup" ? settings.pickupEnabled : f === "curbside" ? settings.curbsideEnabled : settings.deliveryEnabled;
  const allOptions: FulfillmentType[] = ["pickup", "curbside", "delivery"];
  const options = allOptions.filter(isEnabled);
  // Fall back to the first enabled option if the admin turned one off.
  const fulfillment: FulfillmentType = options.includes(chosen) ? chosen : (options[0] ?? "pickup");

  const subtotal = lines.reduce((s, { line, item }) => s + priceOf(item) * line.quantity, 0);
  // What the discount takes off (already out of the subtotal).
  const saved = lines.reduce((s, { line, item }) => s + (item.priceHalalas - priceOf(item)) * line.quantity, 0);
  const drinks = lines.filter(({ item }) => item.category === "drink");
  const rewardApplies = rewardAvailable && useReward && drinks.length > 0;
  // The free drink is the dearest drink, at its discounted price (as the server prices it).
  const discount = rewardApplies ? Math.max(...drinks.map(({ item }) => priceOf(item))) : 0;
  const fee = fulfillment === "delivery" ? (settings?.deliveryFeeHalalas ?? 0) : 0;
  const total = subtotal + fee - discount;
  // A line can't be ordered when the item is off, or its origin is missing or out of stock.
  const lineProblem = ({ line, item }: (typeof lines)[number]): "soldout" | "choose" | "option-out" | "too-many" | null => {
    if (!isOrderable(item)) return "soldout";
    // Fewer left than the cart holds (e.g. someone ordered the last ones meanwhile).
    if (item.stockQuantity != null && inCart(cart.lines, item.id) > item.stockQuantity) return "too-many";
    if (item.options.length === 0) return null;
    const option = item.options.find((o) => o.id === line.optionId);
    if (!option) return "choose";
    return option.isAvailable ? null : "option-out";
  };
  const unavailable = lines.filter((l) => lineProblem(l) !== null);
  const belowMinimum = fulfillment === "delivery" && settings ? subtotal < settings.deliveryMinOrderHalalas : false;

  function locate() {
    if (!("geolocation" in navigator)) {
      setLocError(tr("المتصفح لا يدعم تحديد الموقع", "This browser can't share your location"));
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
        setLocError(tr("تعذّر تحديد موقعك. اكتب العنوان بالتفصيل", "Couldn't find your location. Please write the full address"));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000 },
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    const normalizedPhone = normalizeSaudiPhone(phone);
    const next: Record<string, string | null> = {
      phone: normalizedPhone ? null : tr("اكتب رقم جوال صحيح (مثال: 0512345678)", "Enter a valid mobile number (e.g. 0512345678)"),
      car: fulfillment === "curbside" && !car.trim() ? tr("اكتب نوع السيارة ولونها", "Write your car's make and color") : null,
      address: fulfillment === "delivery" && !address.trim() ? tr("اكتب عنوان التوصيل", "Write the delivery address") : null,
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
      successFeedback();
      // The button turns into a check for a moment before the order opens.
      if (motionOn()) {
        setPlaced(true);
        await new Promise((r) => setTimeout(r, 750));
      }
      cart.clear();
      void navigate(`/orders/${order.id}`, { replace: true });
    } catch (err) {
      // A rejected order is final for this key; a new attempt gets a new one.
      if (err instanceof ApiClientError && err.status !== 0) idempotencyKey.current = newIdempotencyKey();
      if (err instanceof ApiClientError && (err.code === "ITEM_UNAVAILABLE" || err.code === "SHOP_CLOSED" || err.code === "NOT_ENOUGH_STOCK")) void reload();
      // Say which item and how many are left: «باقي حبة وحدة بس من وافل بيكان».
      const short = err instanceof ApiClientError && err.code === "NOT_ENOUGH_STOCK" ? menu?.items.find((i) => i.id === err.details.menuItemId) : undefined;
      setFormError(short && err instanceof ApiClientError ? stockLeftText(short, Number(err.details.remaining ?? 0)) : errorText(err));
    } finally {
      setBusy(false);
    }
  }

  if (!menu) {
    return (
      <ShopLayout>
        <h1 className="page-title">{tr("السلة", "Cart")}</h1>
        {menuError ? <Alert tone="error">{menuError}</Alert> : <CartSkeleton />}
      </ShopLayout>
    );
  }

  if (lines.length === 0) {
    return (
      <ShopLayout>
        <h1 className="page-title">{tr("السلة", "Cart")}</h1>
        <div className="empty">
          <img src="/brand/tent-espresso.png" alt="" className="empty__art" />
          <h2 className="empty__title">{tr("سلتك فارغة", "Your cart is empty")}</h2>
          <p className="empty__sub">{tr("اختر مشروبك من المنيو ونجهّزه لك.", "Pick your drink from the menu and we'll make it for you.")}</p>
          <Link to="/menu" className="btn btn--primary">
            {tr("تصفّح المنيو", "Browse the menu")}
          </Link>
        </div>
      </ShopLayout>
    );
  }

  return (
    <ShopLayout>
      <h1 className="page-title">{tr("السلة", "Cart")}</h1>
      {!menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>{tr("لا نستقبل طلبات الآن", "We're not taking orders right now")}</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}

      <form className="checkout" onSubmit={submit} noValidate>
        <section className="sheet" aria-labelledby="cart-items">
          <h2 id="cart-items" className="pass-label">
            {tr("طلبك", "Your order")}
          </h2>
          <ul className="cart-lines">
            {lines.map((entry) => {
              const { line, item } = entry;
              const key = `${line.menuItemId}|${line.optionId ?? ""}`;
              const problem = lineProblem(entry);
              return (
                <SwipeToDelete key={key} className={`cart-line ${problem === "soldout" ? "cart-line--soldout" : ""}`} onDelete={() => cart.remove(item.id, line.optionId)}>
                  <ItemImage item={item} className="cart-line__img" />
                  <div className="cart-line__body">
                    <div className="cart-line__top">
                      <span className="cart-line__name">{itemName(item)}</span>
                      <span className="cart-line__price">
                        <SalePrice item={item} quantity={line.quantity} rolling />
                      </span>
                    </div>
                    {item.options.length > 0 && (
                      <div className="cart-origins" role="radiogroup" aria-label={optionLabel(item)}>
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
                            {optionName(o)}
                          </button>
                        ))}
                      </div>
                    )}
                    {problem === "soldout" && <span className="badge badge--danger">{tr("نفد، احذفه من السلة", "Sold out, remove it from your cart")}</span>}
                    {problem === "choose" && <span className="badge badge--warning">{tr(`اختر ${optionLabel(item)}`, `Choose the ${optionLabel(item)}`)}</span>}
                    {problem === "option-out" && <span className="badge badge--danger">{tr("هذا المحصول نفد، اختر غيره", "This origin ran out, choose another")}</span>}
                    {problem === "too-many" && <span className="badge badge--warning">{`${stockLeftText(item, item.stockQuantity ?? 0)}، ${tr("قلّل الكمية", "lower the quantity")}`}</span>}
                    <div className="cart-line__actions">
                      <QtyStepper
                        quantity={line.quantity}
                        onChange={(q) => cart.setQuantity(item.id, q, line.optionId)}
                        max={Math.min(MAX_LINE_QUANTITY, line.quantity + stockRoom(item, cart.lines))}
                        onLimit={stockRoom(item, cart.lines) === 0 ? () => showToast(stockLeftText(item, item.stockQuantity ?? 0)) : undefined}
                        label={itemName(item)}
                      />
                      {!openNotes.has(key) && !line.note ? (
                        <button type="button" className="link-btn" onClick={() => setOpenNotes(new Set(openNotes).add(key))}>
                          {tr("إضافة ملاحظة", "Add a note")}
                        </button>
                      ) : null}
                    </div>
                    {(openNotes.has(key) || line.note) && (
                      <input
                        className="note-input"
                        value={line.note}
                        onChange={(e) => cart.setNote(item.id, e.target.value, line.optionId)}
                        placeholder={tr("مثال: بدون سكر، ثلج قليل", "e.g. no sugar, light ice")}
                        maxLength={120}
                        aria-label={tr(`ملاحظة على ${item.nameAr}`, `Note for ${itemName(item)}`)}
                      />
                    )}
                  </div>
                </SwipeToDelete>
              );
            })}
          </ul>
          <Link to="/menu" className="link-btn">
            {tr("+ إضافة أصناف", "+ Add more")}
          </Link>
        </section>

        {rewardAvailable && (
          <section className="sheet sheet--dark">
            <label className="reward-toggle">
              <input type="checkbox" checked={useReward} onChange={(e) => setUseReward(e.target.checked)} />
              <span>
                <strong>{tr("استخدم مشروبك المجاني", "Use your free drink")}</strong>
                <small>
                  {drinks.length === 0
                    ? tr("أضف مشروبًا لاستخدام المكافأة", "Add a drink to use your reward")
                    : useReward
                      ? tr(`نخصم ${riyals(discount)} (أغلى مشروب في طلبك)`, `${riyals(discount)} off (the priciest drink in your order)`)
                      : tr("بطاقتك ممتلئة: استخدم المكافأة لتبدأ جمع أكواب جديدة", "Your card is full: use the reward to start collecting again")}
                </small>
              </span>
            </label>
          </section>
        )}

        <section className="sheet" aria-labelledby="fulfillment">
          <h2 id="fulfillment" className="pass-label">
            {tr("طريقة الاستلام", "How you'll get it")}
          </h2>
          <div className="choice-grid" role="radiogroup" aria-labelledby="fulfillment">
            {allOptions.map((f) => {
              const Icon = FULFILLMENT_ICONS[f];
              // A method the café turned off stays visible so customers know it exists.
              const off = !isEnabled(f);
              return (
                <label key={f} className={`choice ${fulfillment === f && !off ? "choice--on" : ""} ${off ? "choice--off" : ""}`}>
                  <input
                    type="radio"
                    name="fulfillment"
                    value={f}
                    checked={fulfillment === f && !off}
                    disabled={off}
                    onChange={() => setFulfillment(f)}
                  />
                  <Icon />
                  <span>{fulfillmentLabel(f)}</span>
                  {off ? <small>{tr("غير متاحة الآن", "Unavailable now")}</small> : f === "delivery" && settings && <small>{riyals(settings.deliveryFeeHalalas)}</small>}
                </label>
              );
            })}
          </div>
          {options.length === 0 && <p className="muted small">{tr("الاستلام متوقف مؤقتًا، جرّب بعد شوي", "Ordering is paused for now, try again shortly")}</p>}
          {options.length > 0 && fulfillment === "curbside" && (
            <Field
              label={tr("السيارة", "Your car")}
              value={car}
              onChange={(e) => setCar(e.target.value)}
              placeholder={tr("مثال: كامري بيضاء", "e.g. white Camry")}
              hint={tr("نطلع لك الطلب عند السيارة. اضغط «وصلت» من صفحة الطلب عند وصولك", "We'll bring it to your car. Tap \"I'm here\" on the order page when you arrive")}
              maxLength={80}
              error={errors.car}
            />
          )}
          {options.length > 0 && fulfillment === "delivery" && (
            <div className="delivery-fields">
              {session && places && (
                <div className="place-chips" role="radiogroup" aria-label={tr("عناويني", "My places")}>
                  {places.map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      role="radio"
                      aria-checked={placeId === p.id}
                      className={`place-chip ${placeId === p.id ? "is-on" : ""}`}
                      onClick={() => {
                        setPlaceId(p.id);
                        setAddress(placeAddress(p));
                        setCoords({ lat: p.lat, lng: p.lng });
                        setLocError(null);
                        setErrors((e) => ({ ...e, address: null }));
                      }}
                    >
                      <AccountIcon name={placeIcon(p.kind)} className="place-chip__icon" />
                      {placeName(p)}
                    </button>
                  ))}
                  {places.length < MAX_PLACES && (
                    <Link
                      to={`/account/places/new?kind=${places.some((p) => p.kind === "home") ? (places.some((p) => p.kind === "work") ? "other" : "work") : "home"}&back=/cart`}
                      className="place-chip place-chip--add"
                    >
                      {tr("+ عنوان جديد", "+ New place")}
                    </Link>
                  )}
                </div>
              )}
              <div className={`field ${errors.address ? "field--error" : ""}`}>
                <label htmlFor="address">{tr("عنوان التوصيل", "Delivery address")}</label>
                <textarea
                  id="address"
                  rows={3}
                  value={address}
                  onChange={(e) => {
                    setAddress(e.target.value);
                    // Typing a different address: the saved place's pin no longer applies.
                    if (placeId) {
                      setPlaceId(null);
                      setCoords(null);
                    }
                  }}
                  placeholder={tr("الحي، الشارع، رقم البيت، وأي وصف يساعد المندوب", "District, street, house number, and anything that helps the driver")}
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
                {locating
                  ? tr("جارٍ تحديد الموقع…", "Finding you…")
                  : coords
                    ? tr("تم تحديد موقعك ✓", "Location set ✓")
                    : tr("حدّد موقعي على الخريطة", "Use my location")}
              </button>
              {locError && <small className="field__error">{locError}</small>}
              {belowMinimum && settings && (
                <Alert tone="warning">{tr(`الحد الأدنى لطلبات التوصيل ${riyals(settings.deliveryMinOrderHalalas)}`, `Delivery minimum is ${riyals(settings.deliveryMinOrderHalalas)}`)}</Alert>
              )}
            </div>
          )}
        </section>

        <section className="sheet" aria-labelledby="contact">
          <h2 id="contact" className="pass-label">
            {tr("التواصل", "Contact")}
          </h2>
          <Field
            label={tr("رقم الجوال", "Mobile number")}
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
            <label htmlFor="order-note">{tr("ملاحظة على الطلب (اختياري)", "Order note (optional)")}</label>
            <textarea id="order-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} />
          </div>
        </section>

        <section className="sheet summary" aria-label={tr("ملخص الطلب", "Order summary")}>
          <div className="summary__row">
            <span>{tr("المجموع", "Subtotal")}</span>
            <Rolling text={riyals(subtotal)} />
          </div>
          {fee > 0 && (
            <div className="summary__row">
              <span>{tr("التوصيل", "Delivery")}</span>
              <span>{riyals(fee)}</span>
            </div>
          )}
          {discount > 0 && (
            <div className="summary__row summary__row--reward">
              <span>{tr("المشروب المجاني", "Free drink")}</span>
              <span>− {riyals(discount)}</span>
            </div>
          )}
          <div className="summary__row summary__row--total">
            <span>{tr("الإجمالي", "Total")}</span>
            <Rolling text={riyals(total)} />
          </div>
          {saved > 0 && <p className="summary__saved">{tr(`وفّرت ${riyals(saved)} مع الخصم`, `You save ${riyals(saved)} with the discount`)}</p>}
          <p className="summary__pay">{tr("الدفع عند الاستلام", "Pay on pickup")}</p>
        </section>

        {formError && <Alert tone="error">{formError}</Alert>}
        {session ? (
          <div className="checkout__submit">
            <button
              ref={submitRef}
              type="submit"
              className={`btn btn--primary btn--block btn--lg ${placed ? "btn--placed" : ""}`}
              disabled={busy || !menu.shop.isOpen || unavailable.length > 0 || belowMinimum || options.length === 0}
              aria-label={placed ? tr("تم إرسال الطلب", "Order placed") : undefined}
            >
              {placed ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
                </svg>
              ) : busy ? (
                tr("جارٍ إرسال الطلب…", "Sending your order…")
              ) : (
                <>
                  {tr("تأكيد الطلب · ", "Place order · ")}
                  <Rolling text={riyals(total)} />
                </>
              )}
            </button>
          </div>
        ) : (
          <div className="signin-cta">
            <p>{tr("سجّل الدخول لإكمال الطلب وجمع أكوابك", "Sign in to place your order and collect cups")}</p>
            <Link to={withNext("/login", "/cart")} className="btn btn--primary btn--block btn--lg">
              {tr("تسجيل الدخول", "Sign in")}
            </Link>
            <Link to={withNext("/register", "/cart")} className="btn btn--secondary btn--block">
              {tr("إنشاء حساب جديد", "Create an account")}
            </Link>
          </div>
        )}
      </form>
    </ShopLayout>
  );
}
