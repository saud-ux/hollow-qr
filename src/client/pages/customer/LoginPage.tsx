import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { normalizeEmail } from "../../../shared/format";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field } from "../../components/Field";
import { Turnstile } from "../../components/Turnstile";
import { useAuth } from "../../lib/auth";
import { useCaptcha } from "../../lib/captcha";
import { authErrorAr, validateEmail } from "../../lib/validation";

export function LoginForm({ onSuccess, submitLabel = "تسجيل الدخول" }: { onSuccess: () => void; submitLabel?: string }) {
  const { supabase } = useAuth();
  const captcha = useCaptcha();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const emailError = validateEmail(email);
    if (emailError || !password) {
      setError(emailError ?? "يرجى إدخال كلمة المرور");
      return;
    }
    if (!captcha.ready) {
      setError("يرجى إكمال التحقق");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const { error: authError } = await supabase.auth.signInWithPassword({
        email: normalizeEmail(email),
        password,
        options: captcha.options,
      });
      if (authError) {
        setError(authErrorAr(authError));
        return;
      }
      onSuccess();
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  return (
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
      <Field
        label="كلمة المرور"
        type="password"
        autoComplete="current-password"
        dir="ltr"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        required
      />
      {captcha.enabled && <Turnstile siteKey={captcha.siteKey} onToken={captcha.setToken} resetKey={captcha.resetKey} />}
      {error && <Alert tone="error">{error}</Alert>}
      <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
        {busy ? "جارٍ الدخول…" : submitLabel}
      </button>
    </form>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  if (session) return <Navigate to="/wallet" replace />;
  return (
    <CustomerLayout>
      <h1 className="page-title">تسجيل الدخول</h1>
      <LoginForm onSuccess={() => void navigate("/wallet", { replace: true })} />
      <p className="form__alt">
        <Link to="/forgot-password">نسيت كلمة المرور؟</Link>
      </p>
      <p className="form__alt">
        ليس لديك بطاقة؟ <Link to="/register">انضم الآن</Link>
      </p>
    </CustomerLayout>
  );
}
