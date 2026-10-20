import { CheckoutBenefits } from "../../components/CheckoutBenefits";
import { benefitCall, useBenefits, useBenefitQuote } from "../../lib/benefits";
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
import { CarIcon, CardIcon, CashIcon, ItemImage, PhonePayIcon, QtyStepper, ScooterIcon, ShopLayout, StoreIcon } from "../../components/Shop";
import { ApiClientError, apiPost, errorText } from "../../lib/api";
import { enablePush, successFeedback } from "../../lib/native";
import { CALM, motionOn, play } from "../../lib/motion";
import { OriginSwitch } from "../../components/OriginSwitch";
import { Rolling } from "../../components/Rolling";
import { SalePrice } from "../../components/SalePrice";
import { SwipeToDelete } from "../../components/SwipeToDelete";
import { useAuth } from "../../lib/auth";
import { useCart, type CartLine } from "../../lib/cart";
import { newIdempotencyKey } from "../../lib/hooks";
import { riyals, useMenu } from "../../lib/menu";
import { withNext } from "../../lib/next";
import { fulfillmentLabel, itemName, optionLabel } from "../../lib/menuText";
import { closedNote } from "./hours";
import { MAX_PLACES } from "../../../shared/types";
import { AccountIcon } from "../../components/AccountIcons";
import { placeAddress, placeIcon, placeName, usePlaces } from "../../lib/places";
import { tr } from "../../lib/i18n";
import { paymentLabel, paymentNote, paymentReady, usePaymentMethods, type PaymentMethod } from "../../lib/payments";

const lineKey = (line: CartLine) => `${line.menuItemId}|${line.optionId ?? ""}`;

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

const PAYMENT_ICONS: Record<PaymentMethod, () => React.JSX.Element> = {
  applepay: PhonePayIcon,
  samsungpay: PhonePayIcon,
  card: CardIcon,
  on_pickup: CashIcon,
};

type Coords = { lat: number; lng: number };

export function CartPage() {
  const { session, me } = useAuth();
  const cart = useCart();
  const navigate = useNavigate();
  const { menu, error: menuError, reload } = useMenu();
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const stepHeading = useRef<HTMLHeadingElement>(null);
  const stepProgress = useRef<HTMLElement>(null);
  const checkoutForm = useRef<HTMLFormElement>(null);
  const previousStep = useRef(step);
  const submitting = useRef(false);
  const [changingStep, setChangingStep] = useState(false);
  const stepTransition = useRef(false);
  const stepAnimations = useRef<Animation[]>([]);
  const checkoutMounted = useRef(true);
  useEffect(() => {
    checkoutMounted.current = true;
    return () => {
      checkoutMounted.current = false;
      stepAnimations.current.forEach((animation) => animation.cancel());
    };
  }, []);
  useLayoutEffect(() => {
    if (previousStep.current === step) return;
    previousStep.current = step;
    stepHeading.current?.focus({ preventScroll: true });
    stepHeading.current?.scrollIntoView({ block: "start", behavior: motionOn() ? "smooth" : "instant" });
    if (!motionOn()) return;

    // The whole step fades together; forms remain mounted to retain every choice.
    const animations = stepAnimations.current;
    const fade = (element: Element | null | undefined) => {
      if (typeof element?.animate !== "function") return;
      animations.push(element.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 420, easing: "ease-out", fill: "backwards" }));
    };
    fade(stepHeading.current);
    fade(checkoutForm.current?.querySelector(".checkout-pane:not([hidden])"));
    const currentDot = stepProgress.current?.querySelector(".is-current > span > i");
    fade(currentDot);
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => animations.forEach((animation) => animation.cancel());
    const onPreferenceChange = () => { if (preference.matches) cancel(); };
    preference.addEventListener("change", onPreferenceChange);
    return () => {
      cancel();
      preference.removeEventListener("change", onPreferenceChange);
    };
  }, [step]);

  async function goToStep(next: 1 | 2 | 3) {
    if (next === step || stepTransition.current) return;
    stepTransition.current = true;
    setChangingStep(true);
    stepAnimations.current.forEach((animation) => animation.cancel());
    stepAnimations.current = [];
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const outgoing: Animation[] = [];
    const cancel = () => outgoing.forEach((animation) => animation.cancel());
    const onPreferenceChange = () => { if (preference.matches) cancel(); };
    preference.addEventListener("change", onPreferenceChange);
    try {
      if (motionOn()) {
        const targets = [stepHeading.current, checkoutForm.current?.querySelector(".checkout-pane:not([hidden])")];
        for (const element of targets) {
          if (typeof element?.animate !== "function") continue;
          const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 150, easing: "ease-in", fill: "forwards" });
          outgoing.push(animation);
          stepAnimations.current.push(animation);
        }
        await Promise.all(outgoing.map((animation) => animation.finished.catch(() => undefined)));
      }
      if (checkoutMounted.current) setStep(next);
    } finally {
      cancel();
      preference.removeEventListener("change", onPreferenceChange);
      stepTransition.current = false;
      if (checkoutMounted.current) setChangingStep(false);
    }
  }
  const [chosen, setFulfillment] = useState<FulfillmentType>("pickup");
  // Online methods show as «قريبًا» until they're connected; paying on pickup always works.
  const payMethods = usePaymentMethods();
  const [payChosen, setPayment] = useState<PaymentMethod>("on_pickup");
  const payment: PaymentMethod = paymentReady(payChosen) ? payChosen : "on_pickup";
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
  const {account:benefits,error:benefitsError}=useBenefits(!!session);
  const [couponInput,setCouponInput]=useState("");
  const [couponCode,setCouponCode]=useState("");
  const [couponChecking, setCouponChecking] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  const couponRequest = useRef(0);
  const couponRequestBusy = useRef(false);
  useEffect(() => () => { couponRequest.current += 1; }, []);
  const [giftCups,setGiftCups]=useState(0);
  const [useBalance,setUseBalance]=useState(false);
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
  // Deleted with a swipe: the toast above the order button can put the line back.
  const [returning, setReturning] = useState<{ key: string; side: 1 | -1 } | null>(null);
  function deleteLine(line: CartLine, item: MenuItem, side: 1 | -1) {
    const index = cart.lines.indexOf(line);
    cart.remove(line.menuItemId, line.optionId);
    showToast(tr(`حُذف ${itemName(item)}`, `Removed ${itemName(item)}`), {
      action: {
        label: tr("تراجع", "Undo"),
        onClick: () => {
          cart.restore(line, index);
          setReturning({ key: lineKey(line), side });
        },
      },
      above: submitRef.current,
    });
  }

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
  const eligibleGiftQuantity=lines.reduce((n,{line,item})=>n+(benefits?.gift_item_ids.includes(item.id)?line.quantity:0),0);
  const selectedGifts=Math.min(giftCups,benefits?.gift_cups??0,eligibleGiftQuantity);
  const needsQuote=!!session && lines.length>0 && !!(couponCode||selectedGifts||useBalance);
  const {quote,error:quoteError,pending:quotePending}=useBenefitQuote(needsQuote,{
    items:lines.map(({line})=>({menuItemId:line.menuItemId,quantity:line.quantity,optionId:line.optionId??undefined})),
    fulfillment,useReward:rewardApplies,couponCode,giftCups:selectedGifts,useBalance,
  });
  async function applyCoupon() {
    const code = couponInput.trim();
    if (!code || couponRequestBusy.current) return;
    const request = ++couponRequest.current;
    couponRequestBusy.current = true;
    setCouponChecking(true);
    setCouponError(null);
    try {
      const checked = await benefitCall<{ ok: boolean; coupon_id?: string | null }>("quote", {
        items: lines.map(({line}) => ({menuItemId: line.menuItemId, quantity: line.quantity, optionId: line.optionId ?? undefined})),
        fulfillment, useReward: rewardApplies, couponCode: code, giftCups: selectedGifts, useBalance,
      });
      if (request !== couponRequest.current) return;
      if (!checked.ok || !checked.coupon_id) {
        setCouponError(tr("الكوبون غير صحيح أو غير متاح حالياً", "This coupon is invalid or unavailable"));
        return;
      }
      setCouponCode(code);
    } catch (e) {
      if (request === couponRequest.current) setCouponError(errorText(e));
    } finally {
      if (request === couponRequest.current) {
        couponRequestBusy.current = false;
        setCouponChecking(false);
      }
    }
  }
  const total = quote?.due ?? subtotal + fee - discount;
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

  function validateContact() {
    const normalizedPhone = normalizeSaudiPhone(phone);
    const next: Record<string, string | null> = {
      phone: normalizedPhone ? null : tr("اكتب رقم جوال صحيح (مثال: 0512345678)", "Enter a valid mobile number (e.g. 0512345678)"),
      car: fulfillment === "curbside" && !car.trim() ? tr("اكتب نوع السيارة ولونها", "Write your car's make and color") : null,
      address: fulfillment === "delivery" && !address.trim() ? tr("اكتب عنوان التوصيل", "Write the delivery address") : null,
    };
    setErrors(next);
    setFormError(null);
    return Object.values(next).some(Boolean) ? null : normalizedPhone;

  }

  function advance() {
    if (busy || placed || stepTransition.current) return;
    setFormError(null);
    if (step === 1) {
      if (unavailable.length > 0) {
        setFormError(tr("راجع الأصناف والمحاصيل غير المتوفرة", "Review unavailable items and origins"));
        return;
      }
      void goToStep(2);
    } else if (step === 2) {
      if (options.length === 0 || belowMinimum) {
        setFormError(tr("راجع طريقة الاستلام والحد الأدنى للتوصيل", "Review fulfillment and the delivery minimum"));
        return;
      }
      if (validateContact()) void goToStep(3);
    }
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || placed || submitting.current || stepTransition.current) return;
    if (step !== 3) { advance(); return; }
    if (!session) { setFormError(tr("سجّل الدخول لإكمال الطلب", "Sign in to place your order")); return; }
    if (couponRequestBusy.current) return;
    if (needsQuote && (!quote || quotePending || quoteError)) {setFormError(quoteError??tr("انتظر تحديث المبلغ","Wait for the price to update"));return;}
    if (!menu?.shop.isOpen || options.length === 0 || belowMinimum) {
      setFormError(tr("الطلب غير متاح حاليًا، راجع طريقة الاستلام", "Ordering is unavailable; review the fulfillment method"));
      return;
    }
    if (unavailable.length > 0) {
      void goToStep(1);
      setFormError(tr("راجع الأصناف والمحاصيل غير المتوفرة", "Review unavailable items and origins"));
      return;
    }
    const normalizedPhone = validateContact();
    if (!normalizedPhone) { void goToStep(2); return; }

    const body: PlaceOrderRequest = {
      items: lines.map(({ line }) => ({
        menuItemId: line.menuItemId,
        quantity: line.quantity,
        note: line.note.trim() || undefined,
        optionId: line.optionId ?? undefined,
      })),
      fulfillment,
      phone: normalizedPhone,
      carDescription: fulfillment === "curbside" ? car.trim() : undefined,
      deliveryAddress: fulfillment === "delivery" ? address.trim() : undefined,
      deliveryLat: fulfillment === "delivery" ? coords?.lat : undefined,
      deliveryLng: fulfillment === "delivery" ? coords?.lng : undefined,
      note: note.trim() || undefined,
      useReward: rewardApplies,
      couponCode: couponCode || undefined,
      giftCups: selectedGifts,
      useBalance,
      idempotencyKey: idempotencyKey.current,
    };
    submitting.current = true;
    setBusy(true);
    try {
      const { order } = await apiPost<{ order: Order }>("/api/orders", body);
      remember(PHONE_KEY, normalizedPhone);
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
      // A rejected order is final for this key; a new attempt gets a new one. After a
      // network or server error the order may have gone through, so a retry keeps the key.
      if (err instanceof ApiClientError && err.status >= 400 && err.status < 500) idempotencyKey.current = newIdempotencyKey();
      if (err instanceof ApiClientError && (err.code === "ITEM_UNAVAILABLE" || err.code === "SHOP_CLOSED" || err.code === "NOT_ENOUGH_STOCK")) void reload();
      // Say which item and how many are left: «باقي حبة وحدة بس من وافل بيكان».
      const short = err instanceof ApiClientError && err.code === "NOT_ENOUGH_STOCK" ? menu?.items.find((i) => i.id === err.details.menuItemId) : undefined;
      setFormError(short && err instanceof ApiClientError ? stockLeftText(short, Number(err.details.remaining ?? 0)) : errorText(err));
    } finally {
      submitting.current = false;
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
      <h1 ref={stepHeading} tabIndex={-1} className="page-title checkout-step-title">{step === 1 ? tr("سلتك", "Your cart") : step === 2 ? tr("الاستلام والتواصل", "Fulfillment and contact") : tr("راجع طلبك", "Review your order")}</h1>
      <nav ref={stepProgress} className="checkout-progress" aria-label={tr("خطوات الطلب", "Checkout steps")}>
        <span className="checkout-progress__focus" aria-hidden="true" style={{ insetInlineStart: `calc(${(step - .5) * 100 / 3}% + ${(step - 2) * 10 / 3 - 22}px)` }} />
        <span className="checkout-progress__track" aria-hidden="true"><i style={{ transform: `scaleX(${(step - 1) / 2})` }} /></span>
        {([tr("السلة", "Cart"), tr("الاستلام", "Fulfillment"), tr("التأكيد", "Review")] as const).map((label, i) => (
          <button key={i} type="button" className={`checkout-progress__step ${step === i + 1 ? "is-current" : step > i + 1 ? "is-complete" : ""}`} aria-current={step === i + 1 ? "step" : undefined} disabled={i + 1 >= step || busy || placed || changingStep} onClick={() => { void goToStep((i + 1) as 1 | 2 | 3); setFormError(null); }}>
            <span><i>{step > i + 1 ? "✓" : i + 1}</i></span><strong>{label}</strong>
          </button>
        ))}
      </nav>
      {!menu.shop.isOpen && (
        <div className="shop-closed" role="status">
          <strong>{tr("لا نستقبل طلبات الآن", "We're not taking orders right now")}</strong>
          <span>{closedNote(menu.shop.settings)}</span>
        </div>
      )}

      <form ref={checkoutForm} className="checkout checkout-flow" onSubmit={submit} noValidate>
        <div className="checkout-pane" hidden={step !== 1}>
        <section className="sheet" aria-labelledby="cart-items">
          <h2 id="cart-items" className="pass-label">
            {tr("طلبك", "Your order")}
          </h2>
          <ul className="cart-lines">
            {lines.map((entry) => {
              const { line, item } = entry;
              const key = lineKey(line);
              const problem = lineProblem(entry);
              return (
                <SwipeToDelete
                  key={key}
                  className={`cart-line ${problem === "soldout" ? "cart-line--soldout" : ""}`}
                  onDelete={(side) => deleteLine(line, item, side)}
                  appear={returning?.key === key ? returning.side : undefined}
                >
                  <ItemImage item={item} className="cart-line__img" />
                  <div className="cart-line__body">
                    <div className="cart-line__top">
                      <span className="cart-line__name">{itemName(item)}</span>
                      <span className="cart-line__price">
                        <SalePrice item={item} quantity={line.quantity} rolling />
                      </span>
                    </div>
                    {item.options.length > 0 && <details className="checkout-line-options" open={problem === "choose" || problem === "option-out" ? true : undefined}>
                      <summary>{(() => { const selected = item.options.find((o) => o.id === line.optionId); return selected ? tr(selected.nameAr, selected.nameEn || selected.nameAr) : tr(`اختر ${optionLabel(item)}`, `Choose ${optionLabel(item)}`); })()}<span>{tr("تغيير", "Change")}</span></summary>
                      <OriginSwitch item={item} value={line.optionId} onChange={(to) => cart.setOption(item.id, line.optionId, to)} />
                    </details>}
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
                        // Opened from «إضافة ملاحظة»: ready to type.
                        autoFocus={!line.note}
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

        <details className="sheet checkout-order-note">
          <summary>{note ? tr("ملاحظة الطلب", "Order note") : tr("إضافة ملاحظة على الطلب", "Add an order note")}</summary>
          <div className="field"><label htmlFor="order-note">{tr("ملاحظة (اختياري)", "Note (optional)")}</label><textarea id="order-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} /></div>
        </details>
        <div className="sheet checkout-subtotal"><span>{tr("المجموع", "Subtotal")}</span><strong>{riyals(subtotal)}</strong></div>
        </div>

        <div className="checkout-pane" hidden={step !== 2}>
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
        </section>

        </div>

        <div className="checkout-pane" hidden={step !== 3}>
        <section className="sheet checkout-review" aria-label={tr("مراجعة الأصناف", "Review items")}>
          <div className="checkout-review__head"><h2 className="pass-label">{tr("طلبك", "Your order")}</h2><button type="button" className="link-btn" disabled={busy || changingStep} onClick={() => { void goToStep(1); }}>{tr("تعديل", "Edit")}</button></div>
          <ul className="checkout-review__items">{lines.map(({ line, item }) => {
            const origin = item.options.find((o) => o.id === line.optionId);
            return <li key={lineKey(line)}><ItemImage item={item} /><div><strong>{line.quantity} × {itemName(item)}</strong>{origin && <small>{tr(origin.nameAr, origin.nameEn || origin.nameAr)}</small>}{line.note && <small>{line.note}</small>}</div><span>{riyals(priceOf(item) * line.quantity)}</span></li>;
          })}</ul>
          {note && <p className="checkout-review__note">{note}</p>}
          {unavailable.length > 0 && <Alert tone="error">{tr("بعض الأصناف لم تعد متوفرة. عدّل سلتك للمتابعة.", "Some items are no longer available. Edit your cart to continue.")}</Alert>}
        </section>
        <section className="sheet checkout-review" aria-label={tr("مراجعة الاستلام", "Review fulfillment")}>
          <div className="checkout-review__head"><h2 className="pass-label">{tr("الاستلام والتواصل", "Fulfillment and contact")}</h2><button type="button" className="link-btn" disabled={busy || changingStep} onClick={() => { void goToStep(2); }}>{tr("تغيير", "Change")}</button></div>
          <dl className="checkout-review__contact">
            <div><dt>{tr("الاستلام", "Fulfillment")}</dt><dd>{fulfillmentLabel(fulfillment)}</dd></div>
            <div><dt>{tr("الجوال", "Mobile")}</dt><dd dir="ltr">{phone}</dd></div>
            {fulfillment === "curbside" && <div><dt>{tr("السيارة", "Car")}</dt><dd>{car}</dd></div>}
            {fulfillment === "delivery" && <div><dt>{tr("العنوان", "Address")}</dt><dd>{address}</dd></div>}
          </dl>
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

        {session && <>
          <CheckoutBenefits
            compact
            account={benefits}
            selectedGifts={selectedGifts}
            giftLimit={Math.min(benefits?.gift_cups ?? 0, eligibleGiftQuantity)}
            onGiftsChange={setGiftCups}
            couponInput={couponInput}
            onCouponInputChange={value => { setCouponInput(value); setCouponError(null); }}
            couponChecking={couponChecking}
            couponError={couponError}
            couponCode={couponCode}
            couponDiscount={quote?.coupon_discount ?? 0}
            onApplyCoupon={() => void applyCoupon()}
            onRemoveCoupon={() => { setCouponCode(""); setCouponInput(""); setCouponError(null); }}
            useBalance={useBalance}
            onBalanceChange={setUseBalance}
          />
          {benefitsError && <Alert tone="error">{benefitsError}</Alert>}
          {quotePending && <p role="status">{tr("جارٍ تحديث المبلغ…","Updating price…")}</p>}
          {quoteError && <Alert tone="error">{quoteError}</Alert>}
        </>}
        <section className="sheet checkout-payment" aria-labelledby="payment">
          <h2 id="payment" className="pass-label">
            {total === 0 && !quotePending && !quoteError ? tr("لا يوجد مبلغ متبقٍ للدفع", "No payment remaining") : tr("طريقة الدفع", "Payment method")}
          </h2>
          <div className="payment-list" role="radiogroup" aria-labelledby="payment" hidden={total === 0 && !quotePending && !quoteError}>
            {(["on_pickup", ...payMethods.filter(m => m !== "on_pickup" && paymentReady(m))] as PaymentMethod[]).map((m) => {
              const Icon = PAYMENT_ICONS[m];
              const off = !paymentReady(m);
              const selected = payment === m && !off;
              return (
                <label key={m} className={`payment-option${selected ? " payment-option--selected" : ""}${off ? " payment-option--disabled" : ""}`}>
                  <span className="payment-option__icon"><Icon /></span>
                  <span className="payment-option__copy">
                    <span dir={m === "applepay" || m === "samsungpay" ? "ltr" : undefined}>{paymentLabel(m, fulfillment)}</span>
                    {!off && <small>{paymentNote(m)}</small>}
                  </span>
                  {off && <span className="payment-option__badge">{tr("قريبًا", "Soon")}</span>}
                  <input className="payment-option__radio" type="radio" name="payment" value={m} aria-label={paymentLabel(m, fulfillment)} checked={selected} disabled={off} onChange={() => setPayment(m)} />
                </label>
              );
            })}
          </div>
          {total > 0 && payMethods.some(m => !paymentReady(m)) && <details className="checkout-upcoming">
            <summary>{tr("الدفع الإلكتروني قريبًا", "Online payments coming soon")}</summary>
            <div>{payMethods.filter(m => !paymentReady(m)).map(m => <span key={m} aria-disabled="true">{paymentLabel(m, fulfillment)} · {tr("قريبًا", "Soon")}</span>)}</div>
          </details>}
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
          {!quote && discount > 0 && (
            <div className="summary__row summary__row--reward">
              <span>{tr("المشروب المجاني", "Free drink")}</span>
              <span>− {riyals(discount)}</span>
            </div>
          )}
          {quote && <>{quote.gift_discount>0 && <div className="summary__row"><span>{tr("أكواب الضيافة","Gift cups")}</span><span>− {riyals(quote.gift_discount)}</span></div>}{quote.reward_discount>0 && <div className="summary__row"><span>{tr("مكافأة الولاء","Loyalty reward")}</span><span>− {riyals(quote.reward_discount)}</span></div>}{quote.coupon_discount>0 && <div className="summary__row"><span>{tr("الكوبون","Coupon")}</span><span>− {riyals(quote.coupon_discount)}</span></div>}{quote.wallet_used>0 && <div className="summary__row"><span>{tr("من رصيدك","From your balance")}</span><span>− {riyals(quote.wallet_used)}</span></div>}</>}
          <div className="summary__row summary__row--total">
            <span>{quote && quote.wallet_used > 0 ? tr("المتبقي للدفع", "Amount remaining") : tr("الإجمالي", "Total")}</span>
            <Rolling text={riyals(total)} />
          </div>
          {saved > 0 && <p className="summary__saved">{tr(`وفّرت ${riyals(saved)} مع الخصم`, `You save ${riyals(saved)} with the discount`)}</p>}
          <p className="summary__pay">{total === 0 && !quotePending && !quoteError ? tr("لا يوجد مبلغ متبقٍ للدفع", "No payment remaining") : paymentLabel(payment, fulfillment)}</p>
        </section>

        </div>
        {formError && <Alert tone="error">{formError}</Alert>}
        <div className="checkout__submit checkout-step-actions">
          {step > 1 && <button type="button" className="btn btn--secondary checkout-step-back" disabled={busy || placed || changingStep} onClick={() => { void goToStep(step === 3 ? 2 : 1); setFormError(null); }}>{tr("رجوع", "Back")}</button>}
          {step < 3 ? <button type="button" className="btn btn--primary btn--block btn--lg" disabled={busy || changingStep || (step === 1 && unavailable.length > 0)} onClick={advance}>
            {step === 1 ? tr("متابعة للاستلام", "Continue to fulfillment") : tr("متابعة للتأكيد", "Continue to review")}
          </button> : session ? (
          <>
            <button
              ref={submitRef}
              type="submit"
              className={`btn btn--primary btn--block btn--lg ${placed ? "btn--placed" : ""}`}
              disabled={busy || placed || changingStep || couponChecking || (needsQuote && (!quote || quotePending || !!quoteError)) || !menu.shop.isOpen || unavailable.length > 0 || belowMinimum || options.length === 0}
              aria-label={placed ? tr("تم إرسال الطلب", "Order placed") : undefined}
            >
              {placed ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M5 12.5l4.5 4.5L19 7.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} strokeDasharray={1} strokeDashoffset={1} />
                </svg>
              ) : busy ? (
                tr("جارٍ إرسال الطلب…", "Sending your order…")
              ) : quotePending ? (
                tr("جارٍ تحديث المبلغ…", "Updating price…")
              ) : (
                <>
                  {tr("تأكيد الطلب · ", "Place order · ")}
                  <Rolling text={riyals(total)} />
                </>
              )}
            </button>
          </>
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
        </div>
      </form>
    </ShopLayout>
  );
}
