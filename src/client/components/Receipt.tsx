import { useEffect, useLayoutEffect, useRef, type Ref, type RefObject } from "react";
import { createPortal } from "react-dom";
import { amountDue, type MenuItem, type Order } from "../../shared/ordering";
import { formatDateTime, formatWhen } from "../lib/dates";
import { tr } from "../lib/i18n";
import { riyals } from "../lib/menu";
import { fulfillmentLabel, lineName, lineOptionName, statusLabel } from "../lib/menuText";
import { motionOn, play } from "../lib/motion";
import { tapFeedback } from "../lib/native";
import { paperSound, printBurst, stampSound, tearSound } from "../lib/printerSound";

type MenuItems = MenuItem[] | null | undefined;

/**
 * The order as a paper receipt from the café's printer: the order number big,
 * the lines with dotted leaders, the total. It stays white in the dark theme,
 * like real paper. `status` adds the order's status under the number; once
 * the order is picked up or delivered, that is a green ink stamp with the time.
 */
export function ReceiptPaper({ order, menuItems, status = false, thanks = false }: { order: Order; menuItems: MenuItems; status?: boolean; thanks?: boolean }) {
  const delivery = order.fulfillment === "delivery";
  const wallet = order.walletHalalas ?? 0;
  return (
    <div className="paper-receipt">
      <img className="paper-receipt__word" src="/brand/wordmark-espresso.webp" alt="HOLLOW" width={900} height={157} />
      <span className="paper-receipt__c paper-receipt__muted">{tr("كوفي هولو · الزلفي", "HOLLOW · Al Zulfi")}</span>
      <hr />
      <span className="paper-receipt__c paper-receipt__muted">{tr("طلب رقم", "Order")}</span>
      <span className="paper-receipt__no" dir="ltr">
        #{order.orderNumber}
      </span>
      <span className="paper-receipt__c paper-receipt__muted">{formatDateTime(order.createdAt)}</span>
      {status &&
        (order.status === "completed" ? (
          <span className="paper-receipt__stamp">
            <span className="paper-receipt__stamp-tent" aria-hidden="true" />
            ✓ {statusLabel(order)}
            {order.completedAt && <small>{formatWhen(order.completedAt)}</small>}
          </span>
        ) : (
          <span className="paper-receipt__status">{statusLabel(order)}</span>
        ))}
      <hr />
      {order.items.map((line, i) => {
        const option = line.optionNameAr ? lineOptionName(line, menuItems) : null;
        return (
          <span key={i} className="paper-receipt__line">
            <span className="paper-receipt__name">
              {line.quantity} × {lineName(line, menuItems)}
              {option && <small>{option}</small>}
              {line.note && <small>{line.note}</small>}
            </span>
            <span className="paper-receipt__dots" aria-hidden="true" />
            <span>{riyals(line.unitPriceHalalas * line.quantity)}</span>
          </span>
        );
      })}
      {order.deliveryFeeHalalas > 0 && (
        <span className="paper-receipt__line">
          <span>{tr("التوصيل", "Delivery")}</span>
          <span className="paper-receipt__dots" aria-hidden="true" />
          <span>{riyals(order.deliveryFeeHalalas)}</span>
        </span>
      )}
      {order.discountHalalas > 0 && (
        <span className="paper-receipt__line">
          <span>{tr("خصم المكافآت والكوبون", "Rewards and coupon")}</span>
          <span className="paper-receipt__dots" aria-hidden="true" />
          <span>− {riyals(order.discountHalalas)}</span>
        </span>
      )}
      <hr />
      <span className="paper-receipt__line paper-receipt__line--total">
        <span>{tr("الإجمالي", "Total")}</span>
        <span className="paper-receipt__dots" aria-hidden="true" />
        <span>{riyals(order.totalHalalas)}</span>
      </span>
      {wallet > 0 && (
        <>
          <span className="paper-receipt__line">
            <span>{tr("من رصيدك", "From your balance")}</span>
            <span className="paper-receipt__dots" aria-hidden="true" />
            <span>− {riyals(wallet)}</span>
          </span>
          <span className="paper-receipt__line paper-receipt__line--total">
            <span>{delivery ? tr("المتبقي عند التوصيل", "Due on delivery") : tr("المتبقي عند الاستلام", "Due on pickup")}</span>
            <span className="paper-receipt__dots" aria-hidden="true" />
            <span>{riyals(amountDue(order))}</span>
          </span>
        </>
      )}
      <span className="paper-receipt__c paper-receipt__muted">
        {delivery ? tr("الدفع عند التوصيل", "Pay on delivery") : tr("الدفع عند الاستلام", "Pay on pickup")} · {fulfillmentLabel(order.fulfillment)}
      </span>
      <hr />
      <img className="paper-receipt__tent" src="/brand/tent-espresso.webp" alt="" width={1100} height={458} />
      <span className="paper-receipt__c">
        <b>{thanks ? tr("شكرًا لك، نجهّزه الحين", "Thank you, we're on it") : tr("شكرًا لك", "Thank you")}</b>
      </span>
      <span className="paper-receipt__bars" aria-hidden="true" />
    </div>
  );
}

/** «صنف واحد», «صنفين», «3 أصناف», «11 صنف». */
function itemsLabel(count: number): string {
  if (count === 1) return tr("صنف واحد", "1 item");
  if (count === 2) return tr("صنفين", "2 items");
  return tr(`${count} ${count <= 10 ? "أصناف" : "صنف"}`, `${count} items`);
}

/**
 * The receipt torn off and kept on top of the order's ticket: the order
 * number, how many items and the total. Tap it to open the whole receipt.
 * Placing an order prints into it.
 */
export function ReceiptStub({ order, open, waiting, onOpen, ref }: { order: Order; open: boolean; waiting: boolean; onOpen: () => void; ref: Ref<HTMLButtonElement> }) {
  const count = order.items.reduce((n, line) => n + line.quantity, 0);
  return (
    <button
      ref={ref}
      type="button"
      className={`receipt-stub ${waiting ? "is-waiting" : ""}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      aria-label={tr(`فاتورة الطلب رقم ${order.orderNumber}. اضغط لعرضها`, `Receipt for order ${order.orderNumber}. Tap to open`)}
      onClick={onOpen}
    >
      <span className="receipt-stub__no" dir="ltr">
        #{order.orderNumber}
      </span>
      <span className="receipt-stub__main">
        <b>{tr("فاتورة طلبك", "Your receipt")}</b>
        <small>
          {itemsLabel(count)} · {riyals(order.totalHalalas)}
        </small>
      </span>
      <span className="receipt-stub__open" aria-hidden="true">
        {tr("عرض", "Open")}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </span>
    </button>
  );
}

/** Printing goes in bursts with short pauses, like a card machine: the header, the lines, the end. */
const BURSTS: [number, number][] = [
  [0.3, 520],
  [0.74, 720],
  [1, 520],
];
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The moment an order is placed: a small printer drops in over the order page
 * and prints the receipt in bursts (with its sound and a light tap for each),
 * the receipt tears off and folds into `target`, the receipt card on top of
 * the ticket. A tap skips it.
 * Only shown while motion is on.
 */
export function PrintReceipt({ order, menuItems, target, onDone }: { order: Order; menuItems: MenuItems; target: RefObject<HTMLElement | null>; onDone: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  const printer = useRef<HTMLDivElement>(null);
  const feed = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const finished = useRef(false);
  const done = useRef(onDone);
  useEffect(() => {
    done.current = onDone;
  });
  const finish = () => {
    if (finished.current) return;
    finished.current = true;
    done.current();
  };

  useEffect(() => {
    let live = true;
    const going = () => live && !finished.current;
    void (async () => {
      const sheet = paper.current;
      if (!sheet) return;
      void play(root.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 300, easing: "ease-out" });
      await play(printer.current, [{ transform: "translateY(-90px)", opacity: 0 }, { transform: "translateY(4px)", opacity: 1, offset: 0.75 }, { transform: "none", opacity: 1 }], {
        duration: 480,
        easing: "cubic-bezier(.3,.7,.1,1)",
      });
      if (!going()) return;
      printer.current?.classList.add("is-busy");
      let from = -101;
      for (const [upTo, ms] of BURSTS) {
        const to = -101 + upTo * 101;
        printBurst(ms);
        tapFeedback();
        await play(sheet, [{ transform: `translateY(${from}%)` }, { transform: `translateY(${to}%)` }], { duration: ms, easing: "linear", fill: "forwards" });
        if (!going()) return;
        sheet.style.transform = `translateY(${to}%)`;
        sheet.getAnimations().forEach((a) => a.cancel());
        from = to;
        await wait(170);
      }
      printer.current?.classList.remove("is-busy");
      sheet.style.transform = "none";
      await wait(650);
      if (!going()) return;

      // Torn off: a little tug, and the printer leaves.
      tearSound();
      feed.current?.classList.add("is-free");
      await play(sheet, [{ transform: "none" }, { transform: "translateY(10px) rotate(-1.6deg)" }], { duration: 220, easing: "cubic-bezier(.3,.7,.1,1)", fill: "forwards" });
      void play(printer.current, [{ transform: "none", opacity: 1 }, { transform: "translateY(-70px)", opacity: 0 }], { duration: 360, easing: "ease-in", fill: "forwards" });
      await wait(180);
      if (!going()) return;

      // Folded into the receipt card on top of the ticket.
      const band = target.current;
      if (band) {
        const r = sheet.getBoundingClientRect();
        const b = band.getBoundingClientRect();
        const k = b.width / r.width;
        const dx = b.left + b.width / 2 - (r.left + r.width / 2);
        const dy = b.top - r.top;
        void play(root.current, [{ opacity: 1 }, { opacity: 1, offset: 0.4 }, { opacity: 0 }], { duration: 620, easing: "ease-out", fill: "forwards" });
        await play(
          sheet,
          [
            { transform: "translateY(10px) rotate(-1.6deg)", opacity: 1 },
            { transform: `translate(${dx}px, ${dy}px) scale(${k}, ${Math.min(1, (b.height / r.height) * 1.6)})`, opacity: 0 },
          ],
          { duration: 620, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" },
        );
      }
      if (live) finish();
    })();
    return () => {
      live = false;
    };
    // Runs once: the receipt prints the order as it was placed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div ref={root} className="print-receipt" aria-hidden="true" onClick={finish}>
      <div ref={printer} className="printer">
        <img className="printer__mark" src="/brand/wordmark-cream.webp" alt="" width={900} height={157} />
        <span className="printer__led" />
      </div>
      <div ref={feed} className="print-receipt__feed">
        <div ref={paper} style={{ transform: "translateY(-101%)" }}>
          <ReceiptPaper order={order} menuItems={menuItems} thanks />
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * The receipt again, any time: it unrolls out of the button that opened it,
 * over the page, with the order's live status; closing rolls it back.
 */
export function ReceiptSheet({ order, menuItems, from, onClose }: { order: Order; menuItems: MenuItems; from: RefObject<HTMLElement | null>; onClose: () => void }) {
  const backdrop = useRef<HTMLDivElement>(null);
  const paper = useRef<HTMLDivElement>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const closing = useRef(false);
  const stamper = useRef<SVGSVGElement>(null);
  const stamperShadow = useRef<HTMLDivElement>(null);

  // Where the button is, as a transform and clip of the open receipt.
  const rolled = (): Keyframe | null => {
    const origin = from.current;
    const sheet = paper.current;
    if (!origin || !sheet) return null;
    const s = origin.getBoundingClientRect();
    const p = sheet.getBoundingClientRect();
    const k = s.width / p.width;
    return { transform: `translate(${s.left - p.left}px, ${s.top - p.top}px) scale(${k})`, clipPath: `inset(0 0 ${Math.max(0, p.height - s.height / k)}px 0)`, opacity: 0.4 };
  };

  // A picked-up order: once the receipt has unrolled, a wooden stamper comes
  // down on it, presses, and lifts away, leaving the stamp in green ink.
  function stampDown() {
    const stamp = paper.current?.querySelector<HTMLElement>(".paper-receipt__stamp");
    if (!stamp || !motionOn()) return;
    const unrolled = 560;
    const travel = 1250;
    const impact = unrolled + travel * 0.58;
    void play(stamp, [{ opacity: 0, transform: "rotate(-7deg) scale(1.04)" }, { opacity: 0.88, transform: "rotate(-7deg)" }], { duration: 160, delay: impact });
    void play(paper.current?.querySelector(".paper-receipt"), [{ transform: "none" }, { transform: "translateY(3px) scale(.992)" }, { transform: "none" }], {
      duration: 220,
      delay: impact,
      easing: "ease-out",
    });
    window.setTimeout(() => {
      if (closing.current) return;
      stampSound();
      tapFeedback();
    }, impact);
    window.setTimeout(() => {
      const tool = stamper.current;
      const shade = stamperShadow.current;
      if (closing.current || !tool || !shade) return;
      // The stamper's inked pad lands on the stamp: size and place it from there.
      const box = stamp.getBoundingClientRect();
      const cx = box.left + box.width / 2;
      const cy = box.top + box.height / 2;
      const size = stamp.offsetWidth * 1.3;
      Object.assign(tool.style, { width: `${size}px`, height: `${size}px`, left: `${cx - size / 2}px`, top: `${cy + stamp.offsetHeight / 2 - size * PAD_LINE}px` });
      Object.assign(shade.style, { width: `${stamp.offsetWidth * 1.15}px`, left: `${cx - (stamp.offsetWidth * 1.15) / 2}px`, top: `${cy - 10}px` });
      const at = (y: number, x = 0, turn = -7, squash = 1) => `translate(${x}px, ${y}px) rotate(${turn}deg) scale(1, ${squash})`;
      void play(
        tool,
        [
          { opacity: 0, transform: at(-260, 70, -16) },
          { opacity: 1, transform: at(-110), offset: 0.28 },
          { transform: at(-125), offset: 0.46, easing: "cubic-bezier(.6,0,1,1)" },
          { transform: at(0, 0, -7, 0.96), offset: 0.58 },
          { transform: at(0), offset: 0.66 },
          { opacity: 1, transform: at(0), offset: 0.74, easing: "cubic-bezier(.3,0,.5,1)" },
          { opacity: 0, transform: at(-280, 50, 2) },
        ],
        { duration: travel, easing: "ease-out" },
      );
      void play(
        shade,
        [
          { opacity: 0, transform: "scale(.5)" },
          { opacity: 0.18, transform: "scale(.8)", offset: 0.28 },
          { opacity: 0.16, transform: "scale(.78)", offset: 0.46, easing: "ease-in" },
          { opacity: 0.4, transform: "scale(1)", offset: 0.58 },
          { opacity: 0.4, transform: "scale(1)", offset: 0.74 },
          { opacity: 0, transform: "scale(.5)" },
        ],
        { duration: travel, easing: "ease-out" },
      );
    }, unrolled);
  }

  useLayoutEffect(() => {
    const start = rolled();
    paperSound();
    void play(backdrop.current, [{ opacity: 0 }, { opacity: 1 }], { duration: 320, easing: "ease-out" });
    if (start) void play(paper.current, [start, { transform: "none", clipPath: "inset(0 0 0 0)", opacity: 1 }], { duration: 560, easing: "cubic-bezier(.3,.7,.1,1)" });
    stampDown();
    closeBtn.current?.focus();
    // Opens once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function close() {
    if (closing.current) return;
    closing.current = true;
    if (paper.current) paper.current.scrollTop = 0;
    const end = rolled();
    paperSound();
    void play(backdrop.current, [{ opacity: 1 }, { opacity: 0 }], { duration: 340, easing: "ease-in", fill: "forwards" });
    if (end) await play(paper.current, [{ transform: "none", clipPath: "inset(0 0 0 0)", opacity: 1 }, end], { duration: 440, easing: "cubic-bezier(.5,0,.2,1)", fill: "forwards" });
    onClose();
    from.current?.focus();
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && void close();
    document.addEventListener("keydown", onKey);
    document.documentElement.classList.add("sheet-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.documentElement.classList.remove("sheet-open");
    };
    // close() only reads refs and props that don't change while open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return createPortal(
    <div className="receipt-sheet" role="dialog" aria-modal="true" aria-label={tr(`فاتورة الطلب رقم ${order.orderNumber}`, `Receipt for order ${order.orderNumber}`)}>
      <div ref={backdrop} className="receipt-sheet__backdrop" onClick={() => void close()} />
      <div ref={paper} className="receipt-sheet__paper">
        <ReceiptPaper order={order} menuItems={menuItems} status />
      </div>
      {order.status === "completed" && (
        <>
          <div ref={stamperShadow} className="stamper-shadow" aria-hidden="true" />
          <Stamper ref={stamper} />
        </>
      )}
      <button ref={closeBtn} type="button" className="receipt-sheet__close" aria-label={tr("إغلاق الفاتورة", "Close the receipt")} onClick={() => void close()}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M6 6l12 12M18 6 6 18" />
        </svg>
      </button>
    </div>,
    document.body,
  );
}

/** Where the stamper's inked pad is, as a fraction of its height. */
const PAD_LINE = 171 / 200;

/** A wooden hand stamper: a turned handle on a block, a rubber pad inked green. */
function Stamper({ ref }: { ref: Ref<SVGSVGElement> }) {
  return (
    <svg ref={ref} className="stamper" viewBox="0 0 200 200" aria-hidden="true">
      <defs>
        <linearGradient id="stamper-handle" x1="0" x2="1">
          <stop offset="0" stopColor="#9a5a26" />
          <stop offset="0.45" stopColor="#e0a565" />
          <stop offset="1" stopColor="#a4612b" />
        </linearGradient>
        <linearGradient id="stamper-front" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ecd3a9" />
          <stop offset="1" stopColor="#d2ad7a" />
        </linearGradient>
      </defs>
      <path d="M22 104h156l12 16H10Z" fill="#f4e1c0" />
      <rect x="10" y="120" width="180" height="40" rx="2" fill="url(#stamper-front)" />
      <path d="M18 131c40-3 70 3 110-1s50 2 56 1M18 146c30 2 60-3 96 0s50-2 70 1" fill="none" stroke="#a87a45" strokeOpacity=".35" strokeWidth="1.2" />
      <rect x="14" y="160" width="172" height="8" fill="#2a211b" />
      <rect x="16" y="168" width="168" height="3" fill="#2f7d48" />
      <ellipse cx="100" cy="104" rx="30" ry="7" fill="#b06b30" />
      <path d="M78 104c6-14 12-24 12-38 0-10-8-18-8-30 0-16 8-26 18-26s18 10 18 26c0 12-8 20-8 30 0 14 6 24 12 38Z" fill="url(#stamper-handle)" />
      <ellipse cx="100" cy="15" rx="12" ry="4.5" fill="#f0c48f" opacity=".7" />
    </svg>
  );
}
