import { AdminCoupons } from "./AdminCoupons";
import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useSearchParams } from "react-router";
import { RESET_CONFIRM_WORD } from "../../../shared/constants";
import { normalizeEmail } from "../../../shared/format";
import { ROLE_LABELS_AR } from "../../../shared/messages";
import type { DashboardStats, StaffMember } from "../../../shared/types";
import { ConfirmDialog, Dialog } from "../../components/Dialog";
import { Alert, Field } from "../../components/Field";
import { StaffLayout } from "../../components/StaffLayout";
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
  const [pauseTarget, setPauseTarget] = useState<StaffMember | null>(null);
  const [pausing, setPausing] = useState(false);
  const [passwordTarget, setPasswordTarget] = useState<StaffMember | null>(null);

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

  async function onPauseToggle() {
    if (!pauseTarget) return;
    const resume = pauseTarget.paused;
    setPausing(true);
    setError(null);
    setOk(null);
    try {
      await apiPost(`/api/admin/staff/${pauseTarget.id}/${resume ? "resume" : "pause"}`);
      setOk(resume ? `رجع حساب ${pauseTarget.displayName} يشتغل` : `تم إيقاف حساب ${pauseTarget.displayName} مؤقتًا`);
      setPauseTarget(null);
      load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPausing(false);
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
                  {s.paused && <span className="badge badge--danger">موقوف</span>}
                </div>
                <span className="staff-list__email" dir="ltr">
                  {s.email}
                </span>
                <span className="staff-list__date">أُضيف في {formatDate(s.createdAt)}</span>
              </div>
              {s.role === "staff" && (
                <div className="staff-list__actions">
                  <button type="button" className={`btn btn--small ${s.paused ? "btn--primary" : "btn--secondary"}`} onClick={() => setPauseTarget(s)}>
                    {s.paused ? "إعادة تفعيل" : "إيقاف مؤقت"}
                  </button>
                  <button type="button" className="btn btn--small btn--secondary" onClick={() => setPasswordTarget(s)}>
                    كلمة المرور
                  </button>
                  <button type="button" className="btn btn--small btn--danger-soft" onClick={() => setRemoveTarget(s)}>
                    حذف
                  </button>
                </div>
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

      <ConfirmDialog
        open={pauseTarget !== null}
        title={pauseTarget?.paused ? "إعادة تفعيل الموظف" : "إيقاف الموظف مؤقتًا"}
        message={
          pauseTarget ? (
            pauseTarget.paused ? (
              <p>
                يرجع <strong>{pauseTarget.displayName}</strong> يدخل النظام بنفس البريد وكلمة المرور.
              </p>
            ) : (
              <p>
                ما يقدر <strong>{pauseTarget.displayName}</strong> يدخل النظام ولا توصله تنبيهات الطلبات لين ترجّع حسابه. سجل عملياته يبقى كما هو.
              </p>
            )
          ) : null
        }
        confirmLabel={pauseTarget?.paused ? "إعادة تفعيل" : "إيقاف مؤقت"}
        tone={pauseTarget?.paused ? undefined : "danger"}
        busy={pausing}
        onConfirm={() => void onPauseToggle()}
        onCancel={() => !pausing && setPauseTarget(null)}
      />

      {passwordTarget && (
        <StaffPasswordDialog
          member={passwordTarget}
          onClose={() => setPasswordTarget(null)}
          onDone={(text) => {
            setPasswordTarget(null);
            setError(null);
            setOk(text);
          }}
        />
      )}
    </section>
  );
}

/** A new sign-in password for a staff member who forgot theirs. */
function StaffPasswordDialog({ member, onClose, onDone }: { member: StaffMember; onClose: () => void; onDone: (text: string) => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function save(e?: FormEvent) {
    e?.preventDefault();
    const invalid = validatePassword(password);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/admin/staff/${member.id}/password`, { password });
      onDone(`تم تغيير كلمة مرور ${member.displayName}. أعطه الكلمة الجديدة بنفسك`);
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open
      title={`كلمة مرور جديدة لـ ${member.displayName}`}
      onClose={() => !busy && onClose()}
      actions={
        <>
          <button type="button" className="btn btn--primary" disabled={busy || password.length === 0} onClick={() => void save()}>
            {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={onClose} disabled={busy}>
            إلغاء
          </button>
        </>
      }
    >
      <form onSubmit={(e) => void save(e)} noValidate>
        <Field
          label="كلمة المرور الجديدة"
          type="password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="new-password"
          hint="8 أحرف على الأقل، حروف وأرقام"
          error={error}
          autoFocus
        />
      </form>
      <p className="muted small">يدخل فيها من الحين، والكلمة القديمة ما تشتغل.</p>
    </Dialog>
  );
}

/** البدء من جديد: deletes every order and zeroes every card; the accounts stay. */
function ResetPanel({ onReset }: { onReset: () => void }) {
  const [open, setOpen] = useState(false);
  const [word, setWord] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  function close() {
    if (busy) return;
    setOpen(false);
    setWord("");
    setError(null);
  }

  async function reset() {
    setBusy(true);
    setError(null);
    try {
      const r = await apiPost<{ orders: number; cards: number }>("/api/admin/reset", { confirm: word.trim() });
      setDone(`تم حذف ${r.orders} طلب وتصفير ${r.cards} بطاقة. أول طلب جاي رقمه 1`);
      setOpen(false);
      setWord("");
      onReset();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="panel">
      <h2>البدء من جديد</h2>
      <p className="muted">يحذف كل الطلبات ويصفّر الأكواب والأرصدة، وتبقى الحسابات. إذا تحتاج المبيعات، حمّل ملف Excel قبله.</p>
      {done && <Alert tone="success">{done}</Alert>}
      <button type="button" className="btn btn--danger-soft" onClick={() => { setDone(null); setOpen(true); }}>
        حذف الطلبات وتصفير البطاقات
      </button>
      <Dialog
        open={open}
        title="حذف الطلبات وتصفير البطاقات"
        tone="danger"
        onClose={close}
        actions={
          <>
            <button type="button" className="btn btn--danger" disabled={busy || word.trim() !== RESET_CONFIRM_WORD} onClick={() => void reset()}>
              {busy ? "جارٍ الحذف…" : "حذف وتصفير"}
            </button>
            <button type="button" className="btn btn--ghost" onClick={close} disabled={busy}>
              إلغاء
            </button>
          </>
        }
      >
        <ul>
          <li>يحذف كل الطلبات، وأول طلب بعدها رقمه 1</li>
          <li>يصفّر الأكواب في كل البطاقات</li>
          <li>يصفّر الأرصدة وأكواب الهدايا واستخدام الكوبونات</li>
        </ul>
        <p>تبقى الحسابات والعناوين والمنيو والكوبونات والإعدادات، وتنحفظ نسخة احتياطية قبل الحذف.</p>
        {error && <Alert tone="error">{error}</Alert>}
        <Field label={`اكتب «${RESET_CONFIRM_WORD}» للتأكيد`} value={word} onChange={(e) => setWord(e.target.value)} autoComplete="off" />
      </Dialog>
    </section>
  );
}

/** المبيعات والإحصاءات: the loyalty numbers, sales and the CSV exports. */
export function AdminPage() {
  const [stats, setStats] = useState<DashboardStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState<string | null>(null);
  // Bumped after a reset so the sales and the numbers load again.
  const [version, setVersion] = useState(0);

  useEffect(() => {
    apiGet<DashboardStats>("/api/admin/stats")
      .then(setStats)
      .catch((e: unknown) => setError(errorText(e)));
  }, [version]);

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
    <StaffLayout title="المبيعات والإحصاءات" wide>
      {error && <Alert tone="error">{error}</Alert>}
      <SalesPanel key={version} />
      <section className="panel">
        <h2>بطاقة الولاء</h2>
        <div className="stats" aria-label="إحصاءات">
          {STAT_LABELS.map(([key, label]) => (
            <div key={key} className="stat">
              <span className="stat__value">{stats ? String(stats[key]) : "…"}</span>
              <span className="stat__label">{label}</span>
            </div>
          ))}
        </div>
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
      <ResetPanel onReset={() => setVersion((v) => v + 1)} />
    </StaffLayout>
  );
}

/** الموظفين: add and remove staff accounts. */
export function AdminTeamPage() {
  return (
    <StaffLayout title="الموظفين">
      <StaffManagement />
    </StaffLayout>
  );
}

/** العروض والتقييمات: offer notifications and what customers said. */
export function AdminEngagePage() {
  // A low-rating alert opens straight on the ratings (?tab=ratings).
  const [params] = useSearchParams();
  const [tab, setTab] = useState<"coupons" | "offers" | "ratings">(() => {
    const wanted = params.get("tab");
    return wanted === "offers" || wanted === "ratings" ? wanted : "coupons";
  });
  return (
    <StaffLayout title="الكوبونات والعروض" wide>
      <div className="admin-section-nav" role="tablist" aria-label="إدارة تواصل العملاء">
        {([
          ["coupons", "الكوبونات والضيافة"],
          ["offers", "إشعارات العروض"],
          ["ratings", "تقييمات العملاء"],
        ] as const).map(([key, label]) => (
          <button key={key} id={`engage-tab-${key}`} role="tab" type="button"
            aria-selected={tab === key} aria-controls={`engage-panel-${key}`} tabIndex={tab === key ? 0 : -1}
            onKeyDown={(e) => {
              const keys = ["coupons", "offers", "ratings"] as const;
              const index = keys.indexOf(key);
              const rtl = document.documentElement.dir !== "ltr";
              let next: number;
              if (e.key === "Home") next = 0;
              else if (e.key === "End") next = keys.length - 1;
              else if (e.key === "ArrowRight") next = (index + (rtl ? 2 : 1)) % keys.length;
              else if (e.key === "ArrowLeft") next = (index + (rtl ? 1 : 2)) % keys.length;
              else return;
              e.preventDefault();
              setTab(keys[next]!);
              document.getElementById(`engage-tab-${keys[next]}`)?.focus();
            }}
            onClick={() => setTab(key)}>{label}</button>
        ))}
      </div>
      {(["coupons", "offers", "ratings"] as const).map((key) => (
        <div key={key} id={`engage-panel-${key}`} role="tabpanel"
          aria-labelledby={`engage-tab-${key}`} hidden={tab !== key}>
          {key === "coupons" ? <AdminCoupons /> : key === "offers" ? <OffersPanel /> : <RatingsPanel />}
        </div>
      ))}
    </StaffLayout>
  );
}
