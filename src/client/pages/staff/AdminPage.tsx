import { useCallback, useEffect, useState, type FormEvent } from "react";
import { normalizeEmail } from "../../../shared/format";
import { ROLE_LABELS_AR } from "../../../shared/messages";
import type { DashboardStats, Paginated, StaffMember, TransactionItem } from "../../../shared/types";
import { ActivityList } from "../../components/ActivityList";
import { CustomerSearch } from "../../components/CustomerSearch";
import { ConfirmDialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
import { apiDelete, apiDownload, apiGet, apiPost, errorText } from "../../lib/api";
import { formatDate } from "../../lib/dates";
import { validateEmail, validateName, validatePassword } from "../../lib/validation";

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
  const [removing, setRemoving] = useState<StaffMember | null>(null);
  const [removeBusy, setRemoveBusy] = useState(false);

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

  async function onRemove(member: StaffMember) {
    setRemoveBusy(true);
    setError(null);
    setOk(null);
    try {
      await apiDelete(`/api/admin/staff/${member.id}`);
      setOk(`تمت إزالة الموظف ${member.displayName}`);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRemoveBusy(false);
      setRemoving(null);
    }
  }

  return (
    <section className="panel">
      <h2>الموظفون</h2>
      {staff && (
        <table className="table">
          <thead>
            <tr>
              <th scope="col">الاسم</th>
              <th scope="col">البريد</th>
              <th scope="col">الدور</th>
              <th scope="col">تاريخ الإنشاء</th>
              <th scope="col">
                <span className="visually-hidden">إجراءات</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.displayName}</td>
                <td dir="ltr">{s.email}</td>
                <td>{ROLE_LABELS_AR[s.role]}</td>
                <td>{formatDate(s.createdAt)}</td>
                <td>
                  {s.role === "staff" && (
                    <button type="button" className="btn btn--small btn--danger" onClick={() => setRemoving(s)}>
                      إزالة
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {removing && (
        <ConfirmDialog
          open
          tone="danger"
          title={`إزالة الموظف ${removing.displayName}؟`}
          message={<p>لن يتمكن الموظف من تسجيل الدخول إلى لوحة الموظفين بعد الإزالة. تبقى العمليات التي نفذها في السجل.</p>}
          confirmLabel="نعم، إزالة الموظف"
          busy={removeBusy}
          onConfirm={() => void onRemove(removing)}
          onCancel={() => setRemoving(null)}
        />
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
        {error && <Alert tone="error">{error}</Alert>}
        {ok && <Alert tone="success">{ok}</Alert>}
        <button type="submit" className="btn btn--primary" disabled={busy}>
          {busy ? "جارٍ الإنشاء…" : "إنشاء حساب موظف"}
        </button>
      </form>
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
