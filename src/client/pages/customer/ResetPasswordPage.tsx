import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field, Spinner } from "../../components/Field";
import { useAuth } from "../../lib/auth";
import { authErrorAr, validateConfirm, validatePassword } from "../../lib/validation";
import { tr } from "../../lib/i18n";

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
  else if (done) content = <Alert tone="success">{tr("تم تغيير كلمة المرور بنجاح", "Your password was changed")}</Alert>;
  else if (!session) {
    content = (
      <section className="card">
        <Alert tone="error">
          {linkError
            ? tr("رابط الاستعادة غير صالح أو منتهي الصلاحية", "The reset link is invalid or has expired")
            : tr("افتح رابط الاستعادة من بريدك الإلكتروني للمتابعة", "Open the reset link from your email to continue")}
        </Alert>
        <Link to="/forgot-password" className="btn btn--secondary btn--block">
          {tr("طلب رابط جديد", "Get a new link")}
        </Link>
      </section>
    );
  } else {
    content = (
      <form className="card form" onSubmit={onSubmit} noValidate>
        {!recovery && <p className="muted">{tr("أنت مسجّل الدخول، يمكنك تعيين كلمة مرور جديدة.", "You're signed in, you can set a new password.")}</p>}
        <Field
          label={tr("كلمة المرور الجديدة", "New password")}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          hint={tr("8 أحرف على الأقل، حروف وأرقام", "At least 8 characters, letters and numbers")}
          required
        />
        <Field
          label={tr("تأكيد كلمة المرور", "Confirm password")}
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          required
        />
        {error && <Alert tone="error">{error}</Alert>}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          {busy ? tr("جارٍ الحفظ…", "Saving…") : tr("حفظ كلمة المرور", "Save password")}
        </button>
      </form>
    );
  }

  return (
    <CustomerLayout>
      <h1 className="page-title">{tr("تعيين كلمة مرور جديدة", "Set a new password")}</h1>
      {content}
    </CustomerLayout>
  );
}
