import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/constants";
import { tr } from "./i18n";

export function validateName(name: string): string | null {
  const v = name.trim();
  if (!v) return tr("يرجى إدخال الاسم", "Please enter your name");
  if (v.length > DISPLAY_NAME_MAX_LENGTH) return tr("الاسم طويل جدًا", "That name is too long");
  return null;
}

export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return tr("يرجى إدخال البريد الإلكتروني", "Please enter your email");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || v.length > 254) return tr("البريد الإلكتروني غير صحيح", "That email doesn't look right");
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return tr(`كلمة المرور يجب أن تكون ${PASSWORD_MIN_LENGTH} أحرف على الأقل`, `Password must be at least ${PASSWORD_MIN_LENGTH} characters`);
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return tr("كلمة المرور يجب أن تحتوي على حروف وأرقام", "Password must include letters and numbers");
  if (password.length > 128) return tr("كلمة المرور طويلة جدًا", "Password is too long");
  return null;
}

export function validateConfirm(password: string, confirm: string): string | null {
  return password === confirm ? null : tr("كلمتا المرور غير متطابقتين", "Passwords don't match");
}

/** Maps Supabase Auth errors to Arabic messages without leaking details. */
export function authErrorAr(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return tr("البريد الإلكتروني أو كلمة المرور غير صحيحة", "Wrong email or password");
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) return tr("يرجى تأكيد بريدك الإلكتروني من الرسالة المرسلة إليك", "Please confirm your email from the message we sent");
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(msg)) return tr("هذا البريد مسجل مسبقًا", "This email is already registered");
  if (code === "weak_password") return tr("كلمة المرور ضعيفة، اختر كلمة أقوى", "That password is too weak, pick a stronger one");
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) return tr("محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة", "Too many attempts, wait a moment and try again");
  if (code.startsWith("captcha") || /captcha/i.test(msg)) return tr("فشل التحقق من الحماية، أعد المحاولة", "The security check failed, please try again");
  if (code === "same_password") return tr("اختر كلمة مرور مختلفة عن السابقة", "Choose a password different from the old one");
  return tr("حدث خطأ، حاول مرة أخرى", "Something went wrong, please try again");
}
