import { useState, type FormEvent } from "react";
import { Link } from "react-router";
import { normalizeEmail } from "../../../shared/format";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field } from "../../components/Field";
import { Turnstile } from "../../components/Turnstile";
import { useAuth } from "../../lib/auth";
import { useCaptcha } from "../../lib/captcha";
import { useConfig } from "../../lib/config";
import { authErrorAr, validateEmail } from "../../lib/validation";

export function ForgotPasswordPage() {
  const { supabase } = useAuth();
  const config = useConfig();
  const captcha = useCaptcha();
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError) {
      setError(emailError);
      return;
    }
    if (!captcha.ready) {
      setError("يرجى إكمال التحقق");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: `${config.appUrl}/reset-password`,
        ...captcha.options,
      });
      // Do not reveal whether the email exists; only surface rate limits etc.
      if (authError && authError.status === 429) setError(authErrorAr(authError));
      else setSent(true);
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  return (
    <CustomerLayout>
      <h1 className="page-title">استعادة كلمة المرور</h1>
      {sent ? (
        <section className="card">
          <Alert tone="success">إذا كان البريد مسجلًا لدينا فستصلك رسالة تحتوي على رابط لإعادة تعيين كلمة المرور.</Alert>
          <Link to="/login" className="btn btn--secondary btn--block">
            العودة لتسجيل الدخول
          </Link>
        </section>
      ) : (
        <form className="card form" onSubmit={onSubmit} noValidate>
          <Field
            label="البريد الإلكتروني"
            type="email"
            inputMode="email"
            autoComplete="email"
            dir="ltr"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {captcha.enabled && <Turnstile siteKey={captcha.siteKey} onToken={captcha.setToken} resetKey={captcha.resetKey} />}
          {error && <Alert tone="error">{error}</Alert>}
          <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
            {busy ? "جارٍ الإرسال…" : "إرسال رابط الاستعادة"}
          </button>
          <p className="form__alt">
            <Link to="/login">العودة لتسجيل الدخول</Link>
          </p>
        </form>
      )}
    </CustomerLayout>
  );
}
