import { useEffect, useRef, useState } from "react";
import { WEEKDAY_LABELS_AR, type SalesRange, type SalesReport } from "../../../shared/ordering";
import { Alert, Spinner } from "../../components/Field";
import { apiGet, errorText } from "../../lib/api";
import { riyals } from "../../lib/menu";

const RANGES: { value: SalesRange; label: string; compare: string }[] = [
  { value: "today", label: "اليوم", compare: "عن أمس لنفس الوقت" },
  { value: "7d", label: "7 أيام", compare: "عن الأيام السبعة قبلها" },
  { value: "30d", label: "30 يوم", compare: "عن الثلاثين يوم قبلها" },
];

/** "9 ص" / "3 م" on the shop's clock. */
function hourLabel(h: number): string {
  const twelve = h % 12 === 0 ? 12 : h % 12;
  return `${twelve} ${h < 12 ? "ص" : "م"}`;
}

/** Day of week of a YYYY-MM-DD date (0 = Sunday). */
const weekdayOf = (date: string) => new Date(`${date}T12:00:00Z`).getUTCDay();

/** Hours to show: the usual day (7 ص – 11 م), widened if orders came outside it. */
function hourSpan(report: SalesReport): number[] {
  const seen = report.hours.map((h) => h.hour);
  const first = Math.min(7, ...seen);
  const last = Math.max(23, ...seen);
  return Array.from({ length: last - first + 1 }, (_, i) => first + i);
}

/** Sales dashboard: totals with the change from the period before, sales per day, best sellers, busiest hours. */
export function SalesPanel() {
  const [range, setRange] = useState<SalesRange>("7d");
  const [report, setReport] = useState<SalesReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    apiGet<SalesReport>(`/api/admin/sales?range=${range}`)
      .then((r) => {
        if (!alive) return;
        setReport(r);
        setError(null);
      })
      .catch((e: unknown) => alive && setError(errorText(e)));
    return () => {
      alive = false;
    };
  }, [range]);

  const current = RANGES.find((r) => r.value === range)!;
  const shown = report?.range === range ? report : null;

  return (
    <section className="panel sales" aria-labelledby="sales-title">
      <div className="sales__head">
        <h2 id="sales-title">المبيعات</h2>
        <div className="theme-switch" role="radiogroup" aria-label="الفترة">
          {RANGES.map((r) => (
            <button
              key={r.value}
              type="button"
              role="radio"
              aria-checked={range === r.value}
              className={`theme-switch__opt ${range === r.value ? "is-on" : ""}`}
              onClick={() => setRange(r.value)}
            >
              {r.label}
            </button>
          ))}
        </div>
      </div>
      <p className="muted small">الطلبات المكتملة فقط، بتوقيت الرياض.</p>
      {error && <Alert tone="error">{error}</Alert>}
      {!shown && !error && <Spinner />}
      {shown && (
        <>
          <div className="kpis">
            <Kpi label="المبيعات" value={riyals(shown.revenueHalalas)} now={shown.revenueHalalas} before={shown.previous.revenueHalalas} compare={current.compare} />
            <Kpi label="الطلبات" value={String(shown.orders)} now={shown.orders} before={shown.previous.orders} compare={current.compare} />
            <Kpi
              label="متوسط الطلب"
              value={shown.orders ? riyals(Math.round(shown.revenueHalalas / shown.orders)) : "—"}
              now={shown.orders ? shown.revenueHalalas / shown.orders : 0}
              before={shown.previous.orders ? shown.previous.revenueHalalas / shown.previous.orders : 0}
              compare={current.compare}
            />
          </div>
          {shown.cancelled > 0 && (
            <p className="muted small">
              {shown.cancelled === 1 ? "طلب واحد ملغي" : `${shown.cancelled} طلبات ملغاة`} في هذه الفترة.
            </p>
          )}

          {range === "today" ? <HourBars report={shown} /> : <DayBars report={shown} />}
          <TopItems report={shown} />
          {range !== "today" && <BusyHours report={shown} />}
        </>
      )}
    </section>
  );
}

function Kpi({ label, value, now, before, compare }: { label: string; value: string; now: number; before: number; compare: string }) {
  let change: { text: string; tone: "up" | "down" | "flat" } | null = null;
  if (before > 0) {
    const pct = Math.round(((now - before) / before) * 100);
    change = pct === 0 ? { text: "بدون تغيير", tone: "flat" } : { text: `${pct > 0 ? "↑" : "↓"} ${Math.abs(pct)}%`, tone: pct > 0 ? "up" : "down" };
  } else if (now > 0) change = { text: "↑ جديد", tone: "up" };
  return (
    <div className="kpi">
      <span className="kpi__label">{label}</span>
      <span className="kpi__value">{value}</span>
      {change ? (
        <span className={`kpi__change kpi__change--${change.tone}`}>
          {change.text} <small>{compare}</small>
        </span>
      ) : (
        <span className="kpi__change kpi__change--flat">لا يوجد ما نقارن به</span>
      )}
    </div>
  );
}

interface Bar {
  key: string;
  tip: string;
  value: number;
  /** Shown under the bar; empty to skip. */
  tick: string;
}

/**
 * Single-series bar chart (no legend: the heading names it). Newest on the
 * left, like the rest of the right-to-left page; hover or tap a bar for its value.
 */
function Bars({ title, bars, empty }: { title: string; bars: Bar[]; empty: string }) {
  const [active, setActive] = useState<number | null>(null);
  const max = Math.max(...bars.map((b) => b.value), 0);
  // Drawn at the width it is shown, so the text keeps its size on a phone.
  const box = useRef<HTMLElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = box.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(([entry]) => entry && setW(Math.max(Math.round(entry.contentRect.width), 240)));
    observer.observe(el);
    return () => observer.disconnect();
  }, []);
  const H = 170;
  const top = 22;
  const base = H - 22;
  const slot = W / bars.length;
  const width = Math.max(Math.min(slot - 2, 34), 2);
  const peak = max > 0 ? bars.findIndex((b) => b.value === max) : -1;
  const label = active ?? peak;
  // Index 0 is the oldest: draw it on the right.
  const xOf = (i: number) => W - (i + 0.5) * slot;
  return (
    <figure ref={box} className="chart">
      <figcaption className="chart__title">{title}</figcaption>
      {max === 0 ? (
        <p className="muted small chart__empty">{empty}</p>
      ) : (
        <svg viewBox={`0 0 ${W} ${H}`} className="chart__svg" role="img" aria-label={title} onMouseLeave={() => setActive(null)}>
          <line x1="0" x2={W} y1={base} y2={base} className="chart__axis" />
          <line x1="0" x2={W} y1={top} y2={top} className="chart__grid" />
          {bars.map((b, i) => {
            const h = b.value > 0 ? Math.max(((base - top) * b.value) / max, 3) : 0;
            const x = xOf(i);
            return (
              <g key={b.key} onMouseEnter={() => setActive(i)} onClick={() => setActive(i)}>
                <rect x={x - slot / 2} y={top} width={slot} height={H - top} className="chart__hit" />
                {h > 0 && (
                  <path
                    className={`chart__bar ${label === i ? "is-active" : ""}`}
                    d={`M${x - width / 2},${base} V${base - h + Math.min(4, h)} q0,-${Math.min(4, h)} ${Math.min(4, width / 2)},-${Math.min(4, h)} H${x + width / 2 - Math.min(4, width / 2)} q${Math.min(4, width / 2)},0 ${Math.min(4, width / 2)},${Math.min(4, h)} V${base} Z`}
                  />
                )}
                {b.tick && (
                  <text x={x} y={H - 6} className="chart__tick" textAnchor="middle">
                    {b.tick}
                  </text>
                )}
                <title>{b.tip}</title>
              </g>
            );
          })}
          {label >= 0 && bars[label] && (
            <text
              x={Math.min(Math.max(xOf(label), 40), W - 40)}
              y={Math.max(base - ((base - top) * bars[label].value) / max - 6, 14)}
              className="chart__value"
              textAnchor="middle"
            >
              {bars[label].tip}
            </text>
          )}
        </svg>
      )}
    </figure>
  );
}

function DayBars({ report }: { report: SalesReport }) {
  const many = report.days.length > 10;
  const bars = report.days.map((d, i) => {
    const day = Number(d.date.slice(8));
    const weekday = WEEKDAY_LABELS_AR[weekdayOf(d.date)]!;
    return {
      key: d.date,
      value: d.revenueHalalas,
      tip: `${weekday} ${day}: ${riyals(d.revenueHalalas)} · ${d.orders} طلب`,
      tick: many ? (i % 5 === 0 || i === report.days.length - 1 ? String(day) : "") : weekday,
    };
  });
  return <Bars title="المبيعات لكل يوم" bars={bars} empty="ما فيه مبيعات مكتملة في هذه الفترة." />;
}

function HourBars({ report }: { report: SalesReport }) {
  const byHour = new Map(report.hours.map((h) => [h.hour, h.orders]));
  const bars = hourSpan(report).map((h, i) => ({
    key: String(h),
    value: byHour.get(h) ?? 0,
    tip: `${hourLabel(h)}: ${byHour.get(h) ?? 0} طلب`,
    tick: i % 3 === 0 ? hourLabel(h) : "",
  }));
  return <Bars title="الطلبات لكل ساعة اليوم" bars={bars} empty="ما فيه طلبات مكتملة اليوم للحين." />;
}

function TopItems({ report }: { report: SalesReport }) {
  if (report.topItems.length === 0) return null;
  const max = report.topItems[0]!.quantity;
  return (
    <figure className="chart">
      <figcaption className="chart__title">الأكثر طلبًا</figcaption>
      <ol className="top-items">
        {report.topItems.map((t) => (
          <li key={`${t.nameAr}|${t.optionNameAr ?? ""}`} className="top-items__row">
            <span className="top-items__name">
              {t.nameAr}
              {t.optionNameAr && <small> · {t.optionNameAr}</small>}
            </span>
            <span className="top-items__track" aria-hidden="true">
              <i style={{ width: `${(t.quantity / max) * 100}%` }} />
            </span>
            <span className="top-items__value">
              {t.quantity} <small>{riyals(t.revenueHalalas)}</small>
            </span>
          </li>
        ))}
      </ol>
    </figure>
  );
}

/** Orders by weekday and hour: darker gold is busier. */
function BusyHours({ report }: { report: SalesReport }) {
  if (report.hours.length === 0) return null;
  const hours = hourSpan(report);
  const count = new Map(report.hours.map((h) => [`${h.weekday}-${h.hour}`, h.orders]));
  const max = Math.max(...report.hours.map((h) => h.orders));
  return (
    <figure className="chart">
      <figcaption className="chart__title">أوقات الذروة</figcaption>
      <div className="heat" role="table" aria-label="عدد الطلبات حسب اليوم والساعة" style={{ "--hours": hours.length } as React.CSSProperties}>
        <div className="heat__row heat__row--head" role="row">
          <span role="columnheader" />
          {hours.map((h) => (
            <span key={h} role="columnheader" className="heat__hour">
              {h % 3 === 0 ? hourLabel(h) : ""}
            </span>
          ))}
        </div>
        {WEEKDAY_LABELS_AR.map((day, d) => (
          <div key={day} className="heat__row" role="row">
            <span role="rowheader" className="heat__day">
              {day}
            </span>
            {hours.map((h) => {
              const n = count.get(`${d}-${h}`) ?? 0;
              return (
                <span
                  key={h}
                  role="cell"
                  className="heat__cell"
                  style={n ? { background: `rgb(201 162 39 / ${Math.round(18 + (82 * n) / max)}%)` } : undefined}
                  title={`${day} ${hourLabel(h)}: ${n} طلب`}
                  aria-label={`${day} ${hourLabel(h)}: ${n} طلب`}
                />
              );
            })}
          </div>
        ))}
      </div>
      <p className="muted small heat__legend">
        <span className="heat__cell" /> بدون طلبات
        <span className="heat__cell" style={{ background: "rgb(201 162 39 / 100%)" }} /> الأكثر ({max} {max === 1 ? "طلب" : "طلبات"})
      </p>
    </figure>
  );
}
