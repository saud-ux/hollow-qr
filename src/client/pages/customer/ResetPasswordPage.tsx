import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field, Spinner } from "../../components/Field";
import { useAuth } from "../../lib/auth";
import { authErrorAr, validateConfirm, validatePassword } from "../../lib/validation";

/**
 * Landing page for Supabase's password-recovery email link. supabase-js
 * exchanges the link tokens for a short-lived recovery session
 * (PASSWORD_RECOVERY event); the user then sets a new password.
 */
export function ResetPasswordPage() {
  const { supabase, session, loading, recovery } = useAuth();
  const navigate = useNavigate();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const linkError = new URLSearchParams(window.location.hash.slice(1)).get("error_description");

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const err = validatePassword(password) ?? validateConfirm(password, confirm);
    if (err) {
      setError(err);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.updateUser({ password });
      if (authError) {
        setError(authErrorAr(authError));
        return;
      }
      setDone(true);
      setTimeout(() => void navigate("/wallet", { replace: true }), 1500);
    } finally {
      setBusy(false);
    }
  }

  let content;
  if (loading) content = <Spinner />;
  else if (done) content = <Alert tone="success">تم تغيير كلمة المرور بنجاح</Alert>;
  else if (!session) {
    content = (
      <section className="card">
        <Alert tone="error">{linkError ? "رابط الاستعادة غير صالح أو منتهي الصلاحية" : "افتح رابط الاستعادة من بريدك الإلكتروني للمتابعة"}</Alert>
        <Link to="/forgot-password" className="btn btn--secondary btn--block">
          طلب رابط جديد
        </Link>
      </section>
    );
  } else {
    content = (
      <form className="card form" onSubmit={onSubmit} noValidate>
        {!recovery && <p className="muted">أنت مسجّل الدخول، يمكنك تعيين كلمة مرور جديدة.</p>}
        <Field
          label="كلمة المرور الجديدة"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint="8 أحرف على الأقل، حروف وأرقام"
          required
        />
        <Field
          label="تأكيد كلمة المرور"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <Alert tone="error">{error}</Alert>}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          {busy ? "جارٍ الحفظ…" : "حفظ كلمة المرور"}
        </button>
      </form>
    );
  }

  return (
    <CustomerLayout>
      <h1 className="page-title">تعيين كلمة مرور جديدة</h1>
      {content}
    </CustomerLayout>
  );
}
