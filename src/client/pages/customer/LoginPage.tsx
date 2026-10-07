import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { normalizeEmail } from "../../../shared/format";
import { CustomerLayout } from "../../components/CustomerLayout";
import { isNative } from "../../lib/native";
import { Alert, Field } from "../../components/Field";
import { Turnstile } from "../../components/Turnstile";
import { useAuth } from "../../lib/auth";
import { useCaptcha } from "../../lib/captcha";
import { safeNext, withNext } from "../../lib/next";
import { authErrorAr, validateEmail } from "../../lib/validation";
import { tr } from "../../lib/i18n";

export function LoginForm({ onSuccess, submitLabel = tr("تسجيل الدخول", "Sign in") }: { onSuccess: () => void; submitLabel?: string }) {
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
      setError(emailError ?? tr("يرجى إدخال كلمة المرور", "Please enter your password"));
      return;
    }
    if (!captcha.ready) {
      setError(tr("يرجى إكمال التحقق", "Please complete the check"));
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
        label={tr("البريد الإلكتروني", "Email")}
        type="email"
        inputMode="email"
        autoComplete="email"
        dir="ltr"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />
      <Field
        label={tr("كلمة المرور", "Password")}
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
        {busy ? tr("جارٍ الدخول…", "Signing in…") : submitLabel}
      </button>
    </form>
  );
}

export function LoginPage() {
  const { session } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const next = safeNext(params);
  if (session) return <Navigate to={next} replace />;
  return (
    <CustomerLayout hero>
      <section className="hero">
        <h1 className="hero__title">{tr("أهلًا من جديد", "Welcome back")}</h1>
        <p className="hero__sub">{tr("سجّل دخولك عشان تطلب وتتابع أكوابك.", "Sign in to order and keep track of your cups.")}</p>
      </section>
      <LoginForm onSuccess={() => void navigate(next, { replace: true })} />
      <p className="form__alt">
        <Link to="/forgot-password">{tr("نسيت كلمة المرور؟", "Forgot your password?")}</Link>
      </p>
      <p className="form__alt">
        {tr("ليس لديك بطاقة؟", "No card yet?")} <Link to={params.has("next") ? withNext("/register", next) : "/register"}>{tr("انضم الآن", "Join now")}</Link>
      </p>
      {isNative && (
        <p className="form__alt">
          <Link to="/menu">{tr("تصفّح المنيو بدون تسجيل", "Browse the menu without signing in")}</Link>
        </p>
      )}
    </CustomerLayout>
  );
}
