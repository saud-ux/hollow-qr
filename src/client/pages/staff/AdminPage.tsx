import { useCallback, useEffect, useState, type FormEvent } from "react";
import { normalizeEmail } from "../../../shared/format";
import { ROLE_LABELS_AR } from "../../../shared/messages";
import type { DashboardStats, Paginated, StaffMember, TransactionItem } from "../../../shared/types";
import { ActivityList } from "../../components/ActivityList";
import { CustomerSearch } from "../../components/CustomerSearch";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
import { StockPanel } from "../../components/StockCount";
import { apiDownload, apiGet, apiPost, errorText } from "../../lib/api";
import { formatDate } from "../../lib/dates";
import { validateEmail, validateName, validatePassword } from "../../lib/validation";
import { OffersPanel, RatingsPanel } from "./AdminEngagement";
import { SalesPanel } from "./AdminSales";

const STAT_LABELS: [keyof DashboardStats, string][] = [
  ["totalCustomers", "إجمالي العملاء"],
  ["activeCustomers", "العملاء النشطون"],
  ["newToday", "العملاء الجدد اليوم"],
  ["newThisWeek", "العملاء الجدد هذا الأسبوع"],
  ["cupsAddedToday", "عدد الأكواب المضافة اليوم"],
  ["rewardsAvailable", "عدد المكافآت المتاحة"],
  ["rewardsRedeemedToday", "المشروبات المجانية المستخدمة اليوم"],
  ["rewardsRedeemedTotal", "إجمالي المشروبات المجانية المستخدمة"],
];

function StaffManagement() {
  const [staff, setStaff] = useState<StaffMember[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [removeTarget, setRemoveTarget] = useState<StaffMember | null>(null);
  const [removing, setRemoving] = useState(false);

  const load = useCallback(() => {
    apiGet<{ items: StaffMember[] }>("/api/admin/staff")
      .then((r) => setStaff(r.items))
      .catch(() => setStaff([]));
  }, []);
  useEffect(load, [load]);

  async function onCreate(e: FormEvent) {
    e.preventDefault();
    const err = validateName(name) ?? validateEmail(email) ?? validatePassword(password);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      await apiPost("/api/admin/staff", { displayName: name.trim(), email: normalizeEmail(email), password });
      setOk(`تم إنشاء حساب الموظف ${name.trim()}`);
      setName("");
      setEmail("");
      setPassword("");
      load();
    } catch (e2) {
      setError(errorText(e2));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!removeTarget) return;
    setRemoving(true);
    setError(null);
    setOk(null);
    try {
      await apiPost(`/api/admin/staff/${removeTarget.id}/remove`);
      setOk(`تم حذف الموظف ${removeTarget.displayName} بنجاح`);
      setRemoveTarget(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRemoving(false);
    }
  }

  return (
    <section className="panel">
      <h2>الموظفون</h2>
      {error && <Alert tone="error">{error}</Alert>}
      {ok && <Alert tone="success">{ok}</Alert>}
      {staff && (
        <ul className="staff-list">
          {staff.map((s) => (
            <li key={s.id} className="staff-list__item">
              <div className="staff-list__info">
                <div className="staff-list__head">
                  <span className="staff-list__name">{s.displayName}</span>
                  <span className={`badge ${s.role === "admin" ? "badge--gold" : "badge--muted"}`}>{ROLE_LABELS_AR[s.role]}</span>
                </div>
                <span className="staff-list__email" dir="ltr">
                  {s.email}
                </span>
                <span className="staff-list__date">أُضيف في {formatDate(s.createdAt)}</span>
              </div>
              {s.role === "staff" && (
                <button type="button" className="btn btn--small btn--danger-soft" onClick={() => setRemoveTarget(s)}>
                  حذف
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      <form className="form form--inline" onSubmit={onCreate} noValidate>
        <h3>إضافة موظف جديد</h3>
        <Field label="اسم الموظف" value={name} onChange={(e) => setName(e.target.value)} autoComplete="off" />
        <Field label="البريد الإلكتروني" type="email" dir="ltr" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
        <Field
          label="كلمة المرور"
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="8 أحرف على الأقل، حروف وأرقام"
        />
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "جارٍ الإنشاء…" : "إنشاء حساب موظف"}
        </button>
      </form>

      <ConfirmDialog
        open={removeTarget !== null}
        title="حذف الموظف"
        message={
          removeTarget ? (
            <p>
              هل أنت متأكد من حذف الموظف <strong>{removeTarget.displayName}</strong>؟ سيتم إيقاف وصوله للنظام فورًا، مع الاحتفاظ بسجل عملياته السابقة.
            </p>
          ) : null
        }
        confirmLabel="حذف الموظف"
        tone="danger"
        busy={removing}
        onConfirm={() => void onRemove()}
        onCancel={() => !removing && setRemoveTarget(null)}
      />
    </section>
  );
}

export function AdminPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [activity, setActivity] = useState<Paginated<TransactionItem> | null>(null);
  const [page, setPage] = useState(1);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);

  useEffect(() => {
    apiGet<DashboardStats>("/api/admin/stats")
      .then(setStats)
      .catch((e: unknown) => setError(errorText(e)));
  }, []);

  useEffect(() => {
    apiGet<Paginated<TransactionItem>>(`/api/staff/activity?page=${page}&pageSize=15`)
      .then(setActivity)
      .catch(() => setActivity(null));
  }, [page]);

  async function exportCsv(kind: "customers" | "transactions") {
    setExporting(kind);
    try {
      const date = new Date().toISOString().slice(0, 10);
      await apiDownload(`/api/admin/export/${kind}.csv`, `hollow-${kind}-${date}.csv`);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExporting(null);
    }
  }

  return (
    <StaffLayout>
      <h1 className="page-title">لوحة الإدارة</h1>
      {error && <Alert tone="error">{error}</Alert>}
      <section className="stats" aria-label="إحصاءات">
        {STAT_LABELS.map(([key, label]) => (
          <div key={key} className="stat">
            <span className="stat__value">{stats ? String(stats[key]) : "…"}</span>
            <span className="stat__label">{label}</span>
          </div>
        ))}
      </section>

      <SalesPanel />
      <StockPanel />
      <OffersPanel />
      <RatingsPanel />

      <section className="panel">
        <h2>بحث عن عميل</h2>
        <CustomerSearch placeholder="الاسم أو البريد أو رقم العضوية" />
      </section>

      <section className="panel">
        <h2>تصدير البيانات</h2>
        <div className="row">
          <button type="button" className="btn btn--secondary" disabled={exporting !== null} onClick={() => void exportCsv("customers")}>
            {exporting === "customers" ? "جارٍ التصدير…" : "تصدير العملاء (CSV)"}
          </button>
          <button type="button" className="btn btn--secondary" disabled={exporting !== null} onClick={() => void exportCsv("transactions")}>
            {exporting === "transactions" ? "جارٍ التصدير…" : "تصدير العمليات (CSV)"}
          </button>
        </div>
      </section>

      <section className="panel">
        <h2>آخر النشاطات</h2>
        {activity ? (
          <>
            <ActivityList items={activity.items} />
            <div className="pager">
              <button type="button" className="btn btn--small btn--ghost" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                الأحدث
              </button>
              <span>{page}</span>
              <button
                type="button"
                className="btn btn--small btn--ghost"
                disabled={page * activity.pageSize >= activity.total}
                onClick={() => setPage((p) => p + 1)}
              >
                الأقدم
              </button>
            </div>
          </>
        ) : (
          <p className="muted">جارٍ التحميل…</p>
        )}
      </section>

      <StaffManagement />
    </StaffLayout>
  );
}
