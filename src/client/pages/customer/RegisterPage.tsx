import { useState, type FormEvent } from "react";
import { Link, Navigate, useNavigate } from "react-router";
import { normalizeEmail } from "../../../shared/format";
import { CustomerLayout } from "../../components/CustomerLayout";
import { Alert, Field } from "../../components/Field";
import { Turnstile } from "../../components/Turnstile";
import { useAuth } from "../../lib/auth";
import { useCaptcha } from "../../lib/captcha";
import { useConfig } from "../../lib/config";
import { authErrorAr, validateConfirm, validateEmail, validateName, validatePassword } from "../../lib/validation";

type Errors = Partial<Record<"name" | "email" | "password" | "confirm", string | null>>;

export function RegisterPage() {
  const { supabase, session } = useAuth();
  const config = useConfig();
  const navigate = useNavigate();
  const captcha = useCaptcha();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [existing, setExisting] = useState(false);
  const [checkEmail, setCheckEmail] = useState(false);
  const [busy, setBusy] = useState(false);

  if (session && !busy) return <Navigate to="/wallet" replace />;

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
      setFormError("يرجى إكمال التحقق");
      return;
    }
    setBusy(true);
    try {
      const { data, error } = await supabase.auth.signUp({
        email: normalizeEmail(email),
        password,
        options: {
          data: { display_name: name.trim() },
          emailRedirectTo: `${config.appUrl}/wallet?welcome=1`,
          ...captcha.options,
        },
      });
      if (error) {
        const message = authErrorAr(error);
        if (message === "هذا البريد مسجل مسبقًا") setExisting(true);
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
      void navigate("/wallet?welcome=1", { replace: true });
    } finally {
      setBusy(false);
      captcha.reset();
    }
  }

  if (checkEmail) {
    return (
      <CustomerLayout>
        <section className="card center">
          <h1>تم إنشاء بطاقتك بنجاح</h1>
          <p>أرسلنا رابط تأكيد إلى بريدك الإلكتروني. افتح الرابط لتفعيل حسابك ثم أضف بطاقتك إلى Apple Wallet.</p>
          <Link to="/login" className="btn btn--secondary">
            تسجيل الدخول
          </Link>
        </section>
      </CustomerLayout>
    );
  }

  return (
    <CustomerLayout hero>
      <section className="hero">
        <h1 className="hero__title">اشترِ 5 أكواب واحصل على السادس مجانًا</h1>
        <p className="hero__sub">بطاقة ولاء HOLLOW في Apple Wallet — بدون تطبيق.</p>
      </section>
      <form className="card form" onSubmit={onSubmit} noValidate>
        <Field label="الاسم" name="name" autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} error={errors.name} maxLength={80} required />
        <Field
          label="البريد الإلكتروني"
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
          label="كلمة المرور"
          name="password"
          type="password"
          autoComplete="new-password"
          dir="ltr"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          error={errors.password}
          hint="8 أحرف على الأقل، حروف وأرقام"
          required
        />
        <Field
          label="تأكيد كلمة المرور"
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
            هذا البريد مسجل مسبقًا. <Link to="/login">سجّل الدخول</Link> للوصول إلى بطاقتك، أو{" "}
            <Link to="/forgot-password">استعد كلمة المرور</Link>.
          </Alert>
        )}
        {formError && <Alert tone="error">{formError}</Alert>}
        <button type="submit" className="btn btn--primary btn--block btn--lg" disabled={busy}>
          {busy ? "جارٍ الإنشاء…" : "انضم الآن"}
        </button>
        <p className="form__alt">
          لديك حساب؟ <Link to="/login">تسجيل الدخول</Link>
        </p>
      </form>
    </CustomerLayout>
  );
}
