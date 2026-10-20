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
import { tr } from "../../lib/i18n";
import { isNative } from "../../lib/native";
import { emailRedirectUrl } from "../../../shared/email-links";

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
      setError(tr("يرجى إكمال التحقق", "Please complete the check"));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.resetPasswordForEmail(normalizeEmail(email), {
        redirectTo: emailRedirectUrl(config.appUrl, "/reset-password", isNative),
        ...captcha.options,
      });
      // Do not reveal whether the email exists; only surface rate limits and a failure to send
      // (the server or the connection, never an answer about the address).
      if (authError && authError.status === 429) setError(authErrorAr(authError));
      else if (authError && (!authError.status || authError.status >= 500)) {
        setError(tr("تعذّر إرسال الرسالة الآن، حاول بعد قليل أو تواصل معنا", "We couldn't send the email right now. Try again shortly or contact us"));
      } else setSent(true);
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  return (
    <CustomerLayout>
      <h1 className="page-title">{tr("استعادة كلمة المرور", "Reset your password")}</h1>
      {sent ? (
        <section className="card">
          <Alert tone="success">
            {tr(
              "إذا كان البريد مسجلًا لدينا فستصلك رسالة تحتوي على رابط لإعادة تعيين كلمة المرور.",
              "If that email is registered, you'll get a message with a link to reset your password.",
            )}
          </Alert>
          <Link to="/login" className="btn btn--secondary btn--block">
            {tr("العودة لتسجيل الدخول", "Back to sign in")}
          </Link>
        </section>
      ) : (
        <form className="card form" onSubmit={onSubmit} noValidate>
          <Field
            label={tr("البريد الإلكتروني", "Email")}
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
            {busy ? tr("جارٍ الإرسال…", "Sending…") : tr("إرسال رابط الاستعادة", "Send reset link")}
          </button>
          <p className="form__alt">
            <Link to="/login">{tr("العودة لتسجيل الدخول", "Back to sign in")}</Link>
          </p>
        </form>
      )}
    </CustomerLayout>
  );
}
