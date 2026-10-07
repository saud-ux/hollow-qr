import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { normalizeMemberId } from "../../../shared/format";
import type { Paginated, StaffCustomerView, TransactionItem } from "../../../shared/types";
import { ActivityList } from "../../components/ActivityList";
import { CustomerSearch } from "../../components/CustomerSearch";
import { Dialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { QrScannerView } from "../../components/QrScannerView";
import { StaffLayout } from "../../components/StaffLayout";
import { apiGet, apiPost, errorText } from "../../lib/api";
import { errorFeedback, primeAudio, successFeedback } from "../../lib/feedback";

/** العملاء: scan a card, type a member ID or search, and the latest card operations. */
export function StaffHomePage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  // The «مسح QR» button in the header lands here with ?scan=1.
  const [scanning, setScanning] = useState(() => params.get("scan") === "1");
  const [resolving, setResolving] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [manualOpen, setManualOpen] = useState(false);
  const [memberId, setMemberId] = useState("");
  const [manualError, setManualError] = useState<string | null>(null);
  const [activity, setActivity] = useState<Paginated<TransactionItem> | null>(null);
  const [page, setPage] = useState(1);

  useEffect(() => {
    if (params.has("scan")) setParams({}, { replace: true });
  }, [params, setParams]);

  useEffect(() => {
    apiGet<Paginated<TransactionItem>>(`/api/staff/activity?page=${page}&pageSize=10`)
      .then(setActivity)
      .catch(() => setActivity(null));
  }, [page]);

  const resolve = useCallback(
    async (code: string) => {
      setResolving(true);
      try {
        const { customer } = await apiPost<{ customer: StaffCustomerView }>("/api/staff/resolve", { code });
        successFeedback();
        void navigate(`/staff/customers/${customer.accountId}`);
        return true;
      } catch (err) {
        errorFeedback();
        throw err;
      } finally {
        setResolving(false);
      }
    },
    [navigate],
  );

  const onScan = useCallback(
    (text: string) => {
      if (resolving) return;
      setScanError(null);
      resolve(text).catch((err: unknown) => setScanError(errorText(err)));
    },
    [resolve, resolving],
  );

  async function onManual(e: FormEvent) {
    e.preventDefault();
    const normalized = normalizeMemberId(memberId);
    if (!normalized) {
      setManualError("رقم العضوية غير صحيح (مثال: HLW-7KQ2MX)");
      return;
    }
    setManualError(null);
    try {
      await resolve(normalized);
    } catch (err) {
      setManualError(errorText(err));
    }
  }

  return (
    <StaffLayout title="العملاء">
      <div className="staff-home">
        <button
          type="button"
          className="btn btn--primary btn--xl"
          onClick={() => {
            primeAudio();
            setScanError(null);
            setScanning(true);
          }}
        >
          مسح QR
        </button>
        <button type="button" className="btn btn--secondary btn--xl" onClick={() => setManualOpen(true)}>
          إدخال رقم العضوية يدويًا
        </button>
      </div>

      <section className="panel">
        <h2>بحث عن عميل</h2>
        <CustomerSearch placeholder="الاسم أو رقم العضوية" />
      </section>

      <section className="panel">
        <h2>آخر العمليات على البطاقات</h2>
        {activity ? (
          <>
            <ActivityList items={activity.items} />
            {activity.total > activity.pageSize && (
              <div className="pager">
                <button type="button" className="btn btn--small btn--ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  الأحدث
                </button>
                <span>{page}</span>
                <button type="button" className="btn btn--small btn--ghost" disabled={page * activity.pageSize >= activity.total} onClick={() => setPage((p) => p + 1)}>
                  الأقدم
                </button>
              </div>
            )}
          </>
        ) : (
          <p className="muted">جارٍ التحميل…</p>
        )}
      </section>

      {scanning && (
        <>
          <QrScannerView onResult={onScan} onClose={() => setScanning(false)} paused={resolving} />
          {scanError && (
            <div className="scanner__toast" role="alert">
              {scanError}
            </div>
          )}
        </>
      )}

      <Dialog open={manualOpen} title="إدخال رقم العضوية يدويًا" onClose={() => setManualOpen(false)}>
        <form onSubmit={onManual} className="form">
          <Field
            label="رقم العضوية"
            value={memberId}
            onChange={(e) => setMemberId(e.target.value)}
            placeholder="HLW-XXXXXX"
            dir="ltr"
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            error={manualError}
            autoFocus
          />
          <div className="dialog__actions">
            <button type="submit" className="btn btn--primary" disabled={resolving}>
              {resolving ? "جارٍ البحث…" : "فتح"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={() => setManualOpen(false)}>
              إلغاء
            </button>
          </div>
        </form>
      </Dialog>
      {!scanning && scanError && <Alert tone="error">{scanError}</Alert>}
    </StaffLayout>
  );
}
