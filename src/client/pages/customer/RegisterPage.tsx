import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router";
import { normalizeEmail } from "../../../shared/format";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field } from "../../components/Field";
import { Turnstile } from "../../components/Turnstile";
import { useAuth } from "../../lib/auth";
import { useCaptcha } from "../../lib/captcha";
import { useConfig } from "../../lib/config";
import { safeNext, withNext } from "../../lib/next";
import { authErrorAr, validateConfirm, validateEmail, validateName, validatePassword } from "../../lib/validation";
import { tr } from "../../lib/i18n";

type Errors = Partial<Record<"name" | "email" | "password" | "confirm", string | null>>;

export function RegisterPage() {
  const { supabase, session } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const captcha = useCaptcha();
  const [params] = useSearchParams();
  // After signing up from the cart, go back to finish the order.
  const after = safeNext(params, "/wallet?welcome=1");
  const loginLink = params.has("next") ? withNext("/login", after) : "/login";
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session && !busy) return <Navigate to={params.has("next") ? after : "/wallet"} replace />;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const next: Errors = {
      name: validateName(name),
      email: validateEmail(email),
      password: validatePassword(password),
      confirm: validateConfirm(password, confirm),
    };
    setErrors(next);
    setFormError(null);
    setExisting(false);
    if (Object.values(next).some(Boolean)) return;
    if (!captcha.ready) {
      setFormError(tr("يرجى إكمال التحقق", "Please complete the check"));
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${config.appUrl}${after}`,
          ...captcha.options,
        },
      });
      if (error) {
        const message = authErrorAr(error);
        if (message === tr("هذا البريد مسجل مسبقًا", "This email is already registered")) setExisting(true);
        else setFormError(message);
        return;
      }
      // With email confirmation enabled Supabase does not reveal whether the
      // email exists; an existing account comes back with no identities.
      if (data.user && (data.user.identities?.length ?? 0) === 0) {
        setExisting(true);
        return;
      }
      if (!data.session) {
        setCheckEmail(true);
        return;
      }
      void navigate(after, { replace: true });
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  if (checkEmail) {
    return (
      <CustomerLayout>
        <section className="card center">
          <h1>{tr("تم إنشاء بطاقتك بنجاح", "Your card is ready")}</h1>
          <p>
            {tr(
              "أرسلنا رابط تأكيد إلى بريدك الإلكتروني. افتح الرابط لتفعيل حسابك ثم أضف بطاقتك إلى Apple Wallet.",
              "We sent a confirmation link to your email. Open it to activate your account, then add your card to Apple Wallet.",
            )}
          </p>
          <Link to={loginLink} className="btn btn--secondary">
            {tr("تسجيل الدخول", "Sign in")}
          </Link>
        </section>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout hero>
      <section className="hero">
        <h1 className="hero__title">{tr("اشترِ 5 أكواب واحصل على السادس مجانًا", "Buy 5 cups, get the 6th free")}</h1>
        <p className="hero__sub">{tr("بطاقة ولاء HOLLOW في Apple Wallet بدون تطبيق.", "Your HOLLOW loyalty card, right in Apple Wallet.")}</p>
      </section>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <Field label={tr("الاسم", "Name")} name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} required />
        <Field
          label={tr("البريد الإلكتروني", "Email")}
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          error={errors.email}
          required
        />
        <Field
          label={tr("كلمة المرور", "Password")}
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint={tr("8 أحرف على الأقل، حروف وأرقام", "At least 8 characters, letters and numbers")}
          required
        />
        <Field
          label={tr("تأكيد كلمة المرور", "Confirm password")}
          name="confirm"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          error={errors.confirm}
          required
        />
        {captcha.enabled && <Turnstile siteKey={captcha.siteKey} onToken={captcha.setToken} resetKey={captcha.resetKey} />}
        {existing && (
          <Alert tone="warning">
            {tr("هذا البريد مسجل مسبقًا.", "This email is already registered.")} <Link to={loginLink}>{tr("سجّل الدخول", "Sign in")}</Link>{" "}
            {tr("للوصول إلى بطاقتك، أو", "to reach your card, or")} <Link to="/forgot-password">{tr("استعد كلمة المرور", "reset your password")}</Link>.
          </Alert>
        )}
        {formError && <Alert tone="error">{formError}</Alert>}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          {busy ? tr("جارٍ الإنشاء…", "Creating…") : tr("انضم الآن", "Join now")}
        </button>
        <p className="form__alt">
          {tr("لديك حساب؟", "Have an account?")} <Link to={loginLink}>{tr("تسجيل الدخول", "Sign in")}</Link>
        </p>
      </form>
    </CustomerLayout>
  );
}
