import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router";
import { MAX_STAMPS } from "../../../shared/constants";
import { ACTION_LABELS_AR } from "../../../shared/messages";
import type { Paginated, StaffActionRequest, StaffActionResponse, StaffCustomerView, TransactionItem } from "../../../shared/types";
import { ActivityList } from "../../components/ActivityList";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
import { StaffSheet } from "../../components/StaffSheet";
import { ApiClientError, apiGet, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useBenefits } from "../../lib/benefits";
import { formatDate, formatDateTime, formatWhen } from "../../lib/dates";
import { errorFeedback, successFeedback } from "../../lib/feedback";
import { newIdempotencyKey } from "../../lib/hooks";
import { riyals } from "../../lib/menu";
import { BenefitForm, BenefitHistory } from "./CustomerBenefitForm";

type ConfirmKind = "remove" | "undo" | "redeem" | "cancel" | "reactivate" | "adjust";
/** The task a bottom sheet is open for. */
type SheetKind = "add" | "balance" | "gift" | "history" | "admin";

interface SuccessInfo {
  title: string;
  /** The new cup count, after a loyalty action. */
  count?: number;
  reward?: boolean;
}

function successTitle(action: StaffActionRequest["action"]): string {
  switch (action) {
    case "ADD_CUPS":
      return "تمت إضافة الأكواب بنجاح";
    case "REMOVE_CUPS":
      return "تمت إزالة الكوب";
    case "REDEEM_REWARD":
      return "تم استخدام المشروب المجاني";
    case "UNDO":
      return "تم التراجع عن آخر عملية";
    case "CANCEL_MEMBERSHIP":
      return "تم إلغاء العضوية";
    case "REACTIVATE_MEMBERSHIP":
      return "تمت إعادة تفعيل العضوية";
    case "ADMIN_ADJUSTMENT":
      return "تم تعديل الرصيد";
  }
}

/** "كوب واحد", "كوبين", "3 أكواب". */
function cupsText(n: number): string {
  return n === 1 ? "كوب واحد" : n === 2 ? "كوبين" : `${n} أكواب`;
}

const stroke = { fill: "none", stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round", strokeLinejoin: "round" } as const;

/** Line icons for the tiles. */
const ICONS = {
  plus: <path d="M12 5v14M5 12h14" strokeWidth={2.4} />,
  gift: (
    <>
      <rect x="3.5" y="8" width="17" height="4" rx="1" />
      <path d="M5 12v8h14v-8M12 8v12M12 8c-1.5-3-5-3.5-5-1.2C7 8 9.5 8 12 8Zm0 0c1.5-3 5-3.5 5-1.2C17 8 14.5 8 12 8Z" />
    </>
  ),
  wallet: (
    <>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M16 14.5h2" />
    </>
  ),
  cup: <path d="M5 8h14l-1.6 12H6.6L5 8ZM4 5.5h16V8H4z" />,
  history: (
    <>
      <rect x="5" y="4" width="14" height="17" rx="2.5" />
      <path d="M9 10h6M9 14h6M9 17.5h3.5" />
    </>
  ),
  minus: <path d="M5 12h14" strokeWidth={2.2} />,
  undo: <path d="M15 5l5 4-5 4M20 9H10a5.5 5.5 0 0 0 0 11h3" />,
  person: (
    <>
      <circle cx="12" cy="8.5" r="3.8" />
      <path d="M4.5 20c.8-3.8 3.8-6 7.5-6s6.7 2.2 7.5 6" />
    </>
  ),
};

function Icon({ name, size = 22 }: { name: keyof typeof ICONS; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" {...stroke}>
      {ICONS[name]}
    </svg>
  );
}

function Tile({ icon, title, sub, onClick, disabled }: { icon: keyof typeof ICONS; title: string; sub: ReactNode; onClick?: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="staff-tile" disabled={disabled} onClick={onClick}>
      <span className="staff-tile__icon">
        <Icon name={icon} />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{sub}</small>
      </span>
    </button>
  );
}

function MiniTile({ icon, label, onClick, disabled }: { icon: keyof typeof ICONS; label: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="staff-mini" disabled={disabled} onClick={onClick}>
      <span className="staff-mini__icon">
        <Icon name={icon} size={20} />
      </span>
      {label}
    </button>
  );
}

// Omit<> over a union collapses it, so strip fields per member instead.
type ActionInput = StaffActionRequest extends infer T ? (T extends unknown ? Omit<T, "idempotencyKey" | "confirmRecent"> : never) : never;

export function CustomerPage() {
  const { id = "" } = useParams();
  const { me } = useAuth();
  const isAdmin = me?.user.role === "admin";
  const [customer, setCustomer] = useState<StaffCustomerView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);
  const [pending, setPending] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmKind | null>(null);
  const [sheet, setSheet] = useState<SheetKind | null>(null);
  const [adjustTarget, setAdjustTarget] = useState(0);
  const [recentWarning, setRecentWarning] = useState<{ request: StaffActionRequest; secondsAgo?: number; lastAction?: string } | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [history, setHistory] = useState<Paginated<TransactionItem> | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const [benefitsVersion, setBenefitsVersion] = useState(0);
  const pendingRef = useRef(false);

  const [historyVersion, setHistoryVersion] = useState(0);
  const cancelled = customer?.membershipStatus === "cancelled";
  const { account, error: benefitsError } = useBenefits(customer !== null && !cancelled, id, benefitsVersion);

  const load = useCallback(() => {
    apiGet<{ customer: StaffCustomerView }>(`/api/staff/customers/${id}`)
      .then(({ customer: c }) => {
        setCustomer(c);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorText(err)));
  }, [id]);

  useEffect(load, [load]);

  // The cups history is loaded when its sheet opens.
  const historyOpen = sheet === "history";
  useEffect(() => {
    if (!isAdmin || !historyOpen) return;
    let alive = true;
    apiGet<Paginated<TransactionItem>>(`/api/admin/customers/${id}/transactions?page=${historyPage}&pageSize=15`)
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory(null));
    return () => {
      alive = false;
    };
  }, [id, isAdmin, historyOpen, historyPage, historyVersion]);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 2600);
    return () => clearTimeout(t);
  }, [success]);

  const remaining = customer ? MAX_STAMPS - customer.stampCount : 0;
  // The selected quantity can never exceed what can still be added.
  const qty = Math.max(1, Math.min(quantity, remaining));

  async function submit(request: StaffActionRequest) {
    if (pendingRef.current) return; // guard against double taps
    pendingRef.current = true;
    setPending(true);
    setActionError(null);
    try {
      const res = await apiPost<StaffActionResponse>(`/api/staff/customers/${id}/actions`, request);
      setCustomer(res.customer);
      setConfirm(null);
      setSheet(null);
      setRecentWarning(null);
      setSuccess({ title: successTitle(request.action), count: res.newStampCount, reward: res.rewardAvailable });
      setQuantity(1);
      successFeedback();
      setHistoryVersion((v) => v + 1);
    } catch (err) {
      errorFeedback();
      setConfirm(null);
      if (err instanceof ApiClientError && err.code === "RECENT_ACTIVITY") {
        setRecentWarning({
          request,
          secondsAgo: typeof err.details.secondsAgo === "number" ? err.details.secondsAgo : undefined,
          lastAction: typeof err.details.lastAction === "string" ? err.details.lastAction : undefined,
        });
      } else if (err instanceof ApiClientError && err.code === "EXCEEDS_CAPACITY") {
        const left = typeof err.details.remaining === "number" ? err.details.remaining : 0;
        setActionError(`لا يمكن تجاوز 5 أكواب. يمكن إضافة ${left} فقط.`);
        load();
      } else {
        setActionError(errorText(err));
        load();
      }
    } finally {
      pendingRef.current = false;
      setPending(false);
    }
  }

  function start(input: ActionInput) {
    void submit({ ...input, idempotencyKey: newIdempotencyKey() });
  }

  function open(kind: SheetKind) {
    setActionError(null);
    if (kind === "add") setQuantity(1);
    if (kind === "admin" && customer) setAdjustTarget(customer.stampCount);
    setSheet(kind);
  }

  function benefitDone(title: string) {
    setSheet(null);
    setBenefitsVersion((v) => v + 1);
    setSuccess({ title });
    successFeedback();
  }

  if (loadError) {
    return (
      <StaffLayout title="العميل">
        <Alert tone="error">{loadError}</Alert>
        <Link to="/staff/customers" className="btn btn--secondary">
          رجوع
        </Link>
      </StaffLayout>
    );
  }
  if (!customer) {
    return (
      <StaffLayout title="العميل">
        <Spinner />
      </StaffLayout>
    );
  }

  const confirmContent: Record<ConfirmKind, { title: string; message: string; label: string; tone: "default" | "danger" | "warning" }> = {
    remove: {
      title: "إزالة كوب",
      message: `سيتم تغيير الرصيد من ${customer.stampCount} إلى ${customer.stampCount - 1}.`,
      label: "إزالة كوب",
      tone: "warning",
    },
    undo: {
      title: "تراجع عن آخر عملية",
      message: customer.undoCandidate
        ? `سيتم عكس العملية: ${ACTION_LABELS_AR[customer.undoCandidate.action]}${customer.undoCandidate.action === "ADD_CUPS" || customer.undoCandidate.action === "REMOVE_CUPS" ? ` (${customer.undoCandidate.quantity})` : ""}، بتاريخ ${formatDateTime(customer.undoCandidate.createdAt)}. يبقى السجل محفوظًا.`
        : "",
      label: "تأكيد التراجع",
      tone: "warning",
    },
    redeem: {
      title: "استخدام المشروب المجاني",
      message: "سيحصل العميل على مشروب مجاني ويعود الرصيد إلى \u20660 / 5\u2069.",
      label: "تأكيد الاستخدام",
      tone: "default",
    },
    cancel: {
      title: "إلغاء العضوية",
      message: "لن يتمكن العميل من جمع الأكواب أو استخدام المكافأة، وستظهر بطاقته غير نشطة. لا يتم حذف أي بيانات.",
      label: "إلغاء العضوية",
      tone: "danger",
    },
    reactivate: {
      title: "إعادة تفعيل العضوية",
      message: "ستعود العضوية نشطة بنفس الرصيد الحالي.",
      label: "إعادة التفعيل",
      tone: "default",
    },
    adjust: {
      title: "تعديل إداري للرصيد",
      message: `سيتم ضبط الرصيد من ${customer.stampCount} إلى ${adjustTarget}${adjustTarget === MAX_STAMPS ? " (مع مشروب مجاني متاح)" : ""}.`,
      label: "تأكيد التعديل",
      tone: "warning",
    },
  };
  const active = confirm ? confirmContent[confirm] : null;

  function runConfirmed(kind: ConfirmKind) {
    switch (kind) {
      case "remove":
        return start({ action: "REMOVE_CUPS", quantity: 1 });
      case "undo":
        return start({ action: "UNDO" });
      case "redeem":
        return start({ action: "REDEEM_REWARD" });
      case "cancel":
        return start({ action: "CANCEL_MEMBERSHIP" });
      case "reactivate":
        return start({ action: "REACTIVATE_MEMBERSHIP" });
      case "adjust":
        return start({ action: "ADMIN_ADJUSTMENT", targetStampCount: adjustTarget });
    }
  }

  const reward = customer.rewardAvailable && !cancelled;
  const historyTile = (
    <Tile icon="history" title="السجل" sub={customer.lastMutationAt ? `آخر عملية ${formatWhen(customer.lastMutationAt)}` : "لا توجد عمليات"} onClick={() => open("history")} />
  );
  // A sheet shows the error of what it was doing; the page shows the rest.
  const sheetError = actionError && <Alert tone="error">{actionError}</Alert>;

  return (
    <StaffLayout title="العميل">
      <Link to="/staff/customers" className="back-link">
        → العملاء
      </Link>

      {/* The customer's card as they see it: their cups, then who they are. */}
      <section className={`staff-card ${cancelled ? "staff-card--cancelled" : ""}`}>
        <img src={`/wallet-preview/strip-${customer.stampCount}.png`} alt="" className="staff-card__strip" />
        <div className="staff-card__caption">
          <div>
            <h1 className="staff-card__name">{customer.displayName}</h1>
            <span className="staff-card__id" dir="ltr">
              {customer.memberId}
            </span>
          </div>
          <p className="staff-card__count" dir="ltr" aria-label={`${customer.stampCount} من ${MAX_STAMPS} أكواب`}>
            {customer.stampCount} / {MAX_STAMPS}
          </p>
        </div>
      </section>
      {cancelled && <div className="status-banner status-banner--danger">العضوية ملغاة وغير نشطة</div>}
      {!sheet && actionError && <Alert tone="error">{actionError}</Alert>}

      {cancelled ? (
        <div className="staff-tiles">
          {historyTile}
          {isAdmin && <Tile icon="person" title="إدارة العميل" sub="إعادة تفعيل العضوية" onClick={() => open("admin")} />}
        </div>
      ) : (
        <>
          {reward ? (
            <button type="button" className="staff-main staff-main--reward" disabled={pending} onClick={() => setConfirm("redeem")}>
              <span className="staff-main__icon">
                <Icon name="gift" size={32} />
              </span>
              <span>
                <strong>استخدام المشروب المجاني</strong>
                <small>
                  بعدها يرجع العدد إلى <bdi dir="ltr">0 / {MAX_STAMPS}</bdi>
                </small>
              </span>
            </button>
          ) : (
            <button type="button" className="staff-main" disabled={pending} onClick={() => open("add")}>
              <span className="staff-main__icon">
                <Icon name="plus" size={34} />
              </span>
              <span>
                <strong>إضافة أكواب</strong>
                <small>باقي {remaining} للمشروب المجاني</small>
              </span>
            </button>
          )}

          <div className="staff-tiles">
            {reward ? (
              <Tile icon="plus" title="إضافة أكواب" sub="بعد المشروب المجاني" disabled />
            ) : (
              <Tile icon="gift" title="مشروب مجاني" sub={`يتفعّل عند ${MAX_STAMPS} أكواب`} disabled />
            )}
            <Tile
              icon="wallet"
              title="خصم من الرصيد"
              sub={account ? `الرصيد ${riyals(account.balance_halalas)}` : benefitsError ? "تعذّر التحميل" : "…"}
              disabled={!account || account.balance_halalas <= 0}
              onClick={() => open("balance")}
            />
            <Tile
              icon="cup"
              title="كوب ضيافة"
              sub={account ? `باقي ${account.gift_cups}` : benefitsError ? "تعذّر التحميل" : "…"}
              disabled={!account || account.gift_cups <= 0}
              onClick={() => open("gift")}
            />
            {historyTile}
          </div>

          <div className="staff-minis">
            <MiniTile icon="minus" label="إزالة كوب" disabled={pending || customer.stampCount === 0} onClick={() => setConfirm("remove")} />
            <MiniTile icon="undo" label="تراجع" disabled={pending || !customer.undoCandidate} onClick={() => setConfirm("undo")} />
            {isAdmin && <MiniTile icon="person" label="إدارة العميل" onClick={() => open("admin")} />}
          </div>
        </>
      )}

      {sheet === "add" && (
        <StaffSheet title="كم كوب اشترى؟" onClose={() => setSheet(null)}>
          <div className="staff-qty" role="radiogroup" aria-label="عدد الأكواب">
            {Array.from({ length: remaining }, (_, i) => i + 1).map((n) => (
              <button key={n} type="button" role="radio" aria-checked={qty === n} className={qty === n ? "is-on" : ""} disabled={pending} onClick={() => setQuantity(n)}>
                {n}
              </button>
            ))}
          </div>
          {remaining < MAX_STAMPS && <p className="muted staff-sheet__note">يقدر ياخذ {remaining} كحد أقصى قبل المشروب المجاني</p>}
          {sheetError}
          <button type="button" className="btn btn--primary btn--xl" disabled={pending || remaining === 0} onClick={() => start({ action: "ADD_CUPS", quantity: qty })}>
            {pending ? "جارٍ الحفظ…" : `إضافة ${cupsText(qty)}`}
          </button>
        </StaffSheet>
      )}

      {sheet === "balance" && account && (
        <StaffSheet title="خصم من الرصيد" onClose={() => setSheet(null)}>
          <div className="staff-stat">
            الرصيد الحالي <strong>{riyals(account.balance_halalas)}</strong>
          </div>
          <BenefitForm accountId={id} account={account} kind="balance" onDone={benefitDone} />
        </StaffSheet>
      )}

      {sheet === "gift" && account && (
        <StaffSheet title="كوب ضيافة" onClose={() => setSheet(null)}>
          <div className="staff-stat">
            أكواب الضيافة المتبقية <strong>{account.gift_cups}</strong>
          </div>
          <BenefitForm accountId={id} account={account} kind="gift" onDone={benefitDone} />
        </StaffSheet>
      )}

      {sheet === "history" && (
        <StaffSheet title="السجل" onClose={() => setSheet(null)}>
          {isAdmin && (
            <section className="staff-sheet__section">
              <h3>الأكواب</h3>
              {history ? (
                <>
                  <ActivityList items={history.items} showCustomer={false} />
                  {history.total > history.pageSize && (
                    <div className="pager">
                      <button type="button" className="btn btn--small btn--ghost" disabled={historyPage <= 1} onClick={() => setHistoryPage((p) => p - 1)}>
                        الأحدث
                      </button>
                      <span>
                        {historyPage} / {Math.ceil(history.total / history.pageSize)}
                      </span>
                      <button
                        type="button"
                        className="btn btn--small btn--ghost"
                        disabled={historyPage * history.pageSize >= history.total}
                        onClick={() => setHistoryPage((p) => p + 1)}
                      >
                        الأقدم
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <p className="muted">جارٍ التحميل…</p>
              )}
            </section>
          )}
          {account && (
            <section className="staff-sheet__section">
              <h3>الرصيد وأكواب الضيافة</h3>
              <BenefitHistory account={account} />
            </section>
          )}
          {!isAdmin && !account && <p className="muted">{benefitsError ?? "جارٍ التحميل…"}</p>}
        </StaffSheet>
      )}

      {sheet === "admin" && isAdmin && (
        <StaffSheet title="إدارة العميل" onClose={() => setSheet(null)}>
          <dl className="staff-kv">
            <div>
              <dt>البريد</dt>
              <dd dir="ltr">{customer.email}</dd>
            </div>
            <div>
              <dt>تاريخ التسجيل</dt>
              <dd>{formatDate(customer.createdAt)}</dd>
            </div>
            <div>
              <dt>آخر عملية</dt>
              <dd>{formatDateTime(customer.lastMutationAt)}</dd>
            </div>
            <div>
              <dt>بطاقة المحفظة</dt>
              <dd>{customer.walletDevices ? `مضافة على ${customer.walletDevices} جهاز` : "غير مسجلة على أي جهاز"}</dd>
            </div>
          </dl>
          {sheetError}
          {!cancelled && (
            <section className="staff-sheet__section">
              <h3>تعديل عدد الأكواب</h3>
              <div className="staff-choice staff-choice--even" role="radiogroup" aria-label="عدد الأكواب">
                {Array.from({ length: MAX_STAMPS + 1 }, (_, i) => (
                  <button key={i} type="button" role="radio" aria-checked={adjustTarget === i} className={adjustTarget === i ? "is-on" : ""} disabled={pending} onClick={() => setAdjustTarget(i)}>
                    {i}
                  </button>
                ))}
              </div>
              <button type="button" className="btn btn--primary btn--lg" disabled={pending || adjustTarget === customer.stampCount} onClick={() => setConfirm("adjust")}>
                حفظ العدد
              </button>
            </section>
          )}
          {!cancelled && account && (
            <section className="staff-sheet__section">
              <h3>إضافة أو تصحيح الرصيد وأكواب الضيافة</h3>
              <BenefitForm accountId={id} account={account} kind="adjust" onDone={benefitDone} />
            </section>
          )}
          {cancelled ? (
            <button type="button" className="btn btn--secondary btn--lg" disabled={pending} onClick={() => setConfirm("reactivate")}>
              إعادة تفعيل العضوية
            </button>
          ) : (
            <button type="button" className="staff-sheet__danger" disabled={pending} onClick={() => setConfirm("cancel")}>
              إلغاء العضوية
            </button>
          )}
        </StaffSheet>
      )}

      {active && (
        <ConfirmDialog
          open
          title={active.title}
          message={<p>{active.message}</p>}
          confirmLabel={active.label}
          tone={active.tone}
          busy={pending}
          onConfirm={() => confirm && runConfirmed(confirm)}
          onCancel={() => setConfirm(null)}
        />
      )}

      {recentWarning && (
        <ConfirmDialog
          open
          tone="warning"
          title="تم تحديث هذا العميل قبل أقل من دقيقة"
          message={
            <p>
              {recentWarning.lastAction ? `آخر عملية: ${ACTION_LABELS_AR[recentWarning.lastAction] ?? recentWarning.lastAction}` : ""}
              {recentWarning.secondsAgo !== undefined ? ` قبل ${recentWarning.secondsAgo} ثانية.` : ""} هل تريد تنفيذ العملية مرة أخرى؟
            </p>
          }
          confirmLabel="نعم، تنفيذ العملية"
          busy={pending}
          onConfirm={() => void submit({ ...recentWarning.request, confirmRecent: true })}
          onCancel={() => setRecentWarning(null)}
        />
      )}

      <Dialog open={success !== null} title={success?.title ?? ""} onClose={() => setSuccess(null)} tone="success">
        {success && (
          <div className="success">
            {success.count !== undefined && (
              <p className="success__count" dir="ltr">
                {success.count} / {MAX_STAMPS}
              </p>
            )}
            {success.reward && <p className="success__reward">لك مشروب مجاني</p>}
            <button type="button" className="btn btn--primary btn--block" onClick={() => setSuccess(null)}>
              تم
            </button>
          </div>
        )}
      </Dialog>
    </StaffLayout>
  );
}
