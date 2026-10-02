import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { MAX_STAMPS } from "../../../shared/constants";
import { cupsLabel } from "../../../shared/format";
import { ACTION_LABELS_AR } from "../../../shared/messages";
import type { Paginated, StaffActionRequest, StaffActionResponse, StaffCustomerView, TransactionItem } from "../../../shared/types";
import { ActivityList } from "../../components/ActivityList";
import { CupRow } from "../../components/CupRow";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Alert, Spinner } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
import { ApiClientError, apiGet, apiPost, errorText } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { formatDate, formatDateTime } from "../../lib/dates";
import { errorFeedback, successFeedback } from "../../lib/feedback";
import { newIdempotencyKey } from "../../lib/hooks";

type ConfirmKind = "remove" | "undo" | "redeem" | "cancel" | "reactivate" | "adjust";

interface SuccessInfo {
  title: string;
  count: number;
  reward: boolean;
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
  const [adjustTarget, setAdjustTarget] = useState(0);
  const [recentWarning, setRecentWarning] = useState<{ request: StaffActionRequest; secondsAgo?: number; lastAction?: string } | null>(null);
  const [success, setSuccess] = useState<SuccessInfo | null>(null);
  const [history, setHistory] = useState<Paginated<TransactionItem> | null>(null);
  const [historyPage, setHistoryPage] = useState(1);
  const pendingRef = useRef(false);

  const [historyVersion, setHistoryVersion] = useState(0);

  const load = useCallback(() => {
    apiGet<{ customer: StaffCustomerView }>(`/api/staff/customers/${id}`)
      .then(({ customer: c }) => {
        setCustomer(c);
        setLoadError(null);
      })
      .catch((err: unknown) => setLoadError(errorText(err)));
  }, [id]);

  useEffect(load, [load]);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    apiGet<Paginated<TransactionItem>>(`/api/admin/customers/${id}/transactions?page=${historyPage}&pageSize=15`)
      .then((h) => alive && setHistory(h))
      .catch(() => alive && setHistory(null));
    return () => {
      alive = false;
    };
  }, [id, isAdmin, historyPage, historyVersion]);

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

  if (loadError) {
    return (
      <StaffLayout>
        <Alert tone="error">{loadError}</Alert>
        <Link to="/staff" className="btn btn--secondary">
          رجوع
        </Link>
      </StaffLayout>
    );
  }
  if (!customer) {
    return (
      <StaffLayout>
        <Spinner />
      </StaffLayout>
    );
  }

  const cancelled = customer.membershipStatus === "cancelled";
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
        ? `سيتم عكس العملية: ${ACTION_LABELS_AR[customer.undoCandidate.action]}${customer.undoCandidate.action === "ADD_CUPS" || customer.undoCandidate.action === "REMOVE_CUPS" ? ` (${customer.undoCandidate.quantity})` : ""} — ${formatDateTime(customer.undoCandidate.createdAt)}. يبقى السجل محفوظًا.`
        : "",
      label: "تأكيد التراجع",
      tone: "warning",
    },
    redeem: {
      title: "استخدام المشروب المجاني",
      message: "سيحصل العميل على مشروب مجاني ويعود الرصيد إلى 0 / 5.",
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

  return (
    <StaffLayout>
      <Link to="/staff" className="back-link">
        → رجوع
      </Link>

      <section className={`customer-card ${cancelled ? "customer-card--cancelled" : ""} ${customer.rewardAvailable ? "customer-card--reward" : ""}`}>
        <p className="customer-card__program" dir="ltr">
          HOLLOW Rewards
        </p>
        <h1 className="customer-card__name">{customer.displayName}</h1>
        <p className="customer-card__meta">
          <span dir="ltr">{customer.email}</span>
          <span dir="ltr">{customer.memberId}</span>
        </p>
        {cancelled && <div className="status-banner status-banner--danger">العضوية ملغاة — غير نشطة</div>}
        <p className="customer-card__count" dir="ltr">
          {cupsLabel(customer.stampCount)}
        </p>
        <CupRow count={customer.stampCount} size="lg" muted={cancelled} />
        {customer.rewardAvailable && !cancelled && <div className="status-banner status-banner--reward">لك مشروب مجاني</div>}
      </section>

      {actionError && <Alert tone="error">{actionError}</Alert>}

      {!cancelled && (
        <section className="actions">
          {customer.rewardAvailable ? (
            <>
              <button type="button" className="btn btn--reward btn--xl" disabled={pending} onClick={() => setConfirm("redeem")}>
                استخدام المشروب المجاني
              </button>
              <Alert tone="warning">لا يمكن إضافة أكواب الآن. استخدم المشروب المجاني الحالي قبل بدء دورة جديدة.</Alert>
            </>
          ) : (
            <div className="add-cups">
              <h2>إضافة أكواب</h2>
              <div className="qty" role="radiogroup" aria-label="عدد الأكواب">
                {Array.from({ length: MAX_STAMPS }, (_, i) => i + 1).map((n) => (
                  <button
                    key={n}
                    type="button"
                    role="radio"
                    aria-checked={qty === n}
                    className={`qty__btn ${qty === n ? "qty__btn--on" : ""}`}
                    disabled={n > remaining || pending}
                    onClick={() => setQuantity(n)}
                  >
                    +{n}
                  </button>
                ))}
              </div>
              <p className="muted small">يمكن إضافة {remaining} كحد أقصى قبل الوصول إلى المشروب المجاني.</p>
              <button
                type="button"
                className="btn btn--primary btn--xl"
                disabled={pending || remaining === 0}
                onClick={() => start({ action: "ADD_CUPS", quantity: qty })}
              >
                {pending ? "جارٍ الحفظ…" : `إضافة ${qty} ${qty === 1 ? "كوب" : "أكواب"}`}
              </button>
            </div>
          )}

          <div className="actions__secondary">
            {customer.stampCount > 0 && (
              <button type="button" className="btn btn--ghost btn--lg" disabled={pending} onClick={() => setConfirm("remove")}>
                إزالة كوب
              </button>
            )}
            {customer.undoCandidate && (
              <button type="button" className="btn btn--ghost btn--lg" disabled={pending} onClick={() => setConfirm("undo")}>
                تراجع عن آخر عملية
              </button>
            )}
          </div>
        </section>
      )}

      {isAdmin && (
        <section className="panel admin-tools">
          <h2>أدوات المدير</h2>
          <dl className="details">
            <div>
              <dt>البريد الإلكتروني</dt>
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
              <dt>Apple Wallet</dt>
              <dd>{customer.walletDevices ? `مضافة على ${customer.walletDevices} جهاز` : "غير مسجلة على أي جهاز"}</dd>
            </div>
          </dl>
          {!cancelled && (
            <div className="admin-tools__row">
              <label>
                ضبط الرصيد إلى{" "}
                <select value={adjustTarget} onChange={(e) => setAdjustTarget(Number(e.target.value))} disabled={pending}>
                  {Array.from({ length: MAX_STAMPS + 1 }, (_, i) => (
                    <option key={i} value={i}>
                      {i}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn--secondary"
                disabled={pending || adjustTarget === customer.stampCount}
                onClick={() => setConfirm("adjust")}
              >
                تعديل
              </button>
            </div>
          )}
          <div className="admin-tools__row">
            {cancelled ? (
              <button type="button" className="btn btn--secondary" disabled={pending} onClick={() => setConfirm("reactivate")}>
                إعادة تفعيل العضوية
              </button>
            ) : (
              <button type="button" className="btn btn--danger" disabled={pending} onClick={() => setConfirm("cancel")}>
                إلغاء العضوية
              </button>
            )}
          </div>
          <h3>سجل العمليات</h3>
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
            <p className="success__count" dir="ltr">
              {success.count} / {MAX_STAMPS}
            </p>
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
