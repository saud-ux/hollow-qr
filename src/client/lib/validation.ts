import { DISPLAY_NAME_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "../../shared/constants";

export function validateName(name: string): string | null {
  const v = name.trim();
  if (!v) return "يرجى إدخال الاسم";
  if (v.length > DISPLAY_NAME_MAX_LENGTH) return "الاسم طويل جدًا";
  return null;
}

export function validateEmail(email: string): string | null {
  const v = email.trim();
  if (!v) return "يرجى إدخال البريد الإلكتروني";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v) || v.length > 254) return "البريد الإلكتروني غير صحيح";
  return null;
}

export function validatePassword(password: string): string | null {
  if (password.length < PASSWORD_MIN_LENGTH) return `كلمة المرور يجب أن تكون ${PASSWORD_MIN_LENGTH} أحرف على الأقل`;
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) return "كلمة المرور يجب أن تحتوي على حروف وأرقام";
  if (password.length > 128) return "كلمة المرور طويلة جدًا";
  return null;
}

export function validateConfirm(password: string, confirm: string): string | null {
  return password === confirm ? null : "كلمتا المرور غير متطابقتين";
}

/** Maps Supabase Auth errors to Arabic messages without leaking details. */
export function authErrorAr(error: { code?: string; message?: string; status?: number } | null | undefined): string {
  const code = error?.code ?? "";
  const msg = error?.message ?? "";
  if (code === "invalid_credentials" || /invalid login credentials/i.test(msg)) return "البريد الإلكتروني أو كلمة المرور غير صحيحة";
  if (code === "email_not_confirmed" || /email not confirmed/i.test(msg)) return "يرجى تأكيد بريدك الإلكتروني من الرسالة المرسلة إليك";
  if (code === "user_already_exists" || code === "email_exists" || /already registered/i.test(msg)) return "هذا البريد مسجل مسبقًا";
  if (code === "weak_password") return "كلمة المرور ضعيفة، اختر كلمة أقوى";
  if (code === "over_request_rate_limit" || code === "over_email_send_rate_limit" || error?.status === 429) return "محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة";
  if (code.startsWith("captcha") || /captcha/i.test(msg)) return "فشل التحقق من الحماية، أعد المحاولة";
  if (code === "same_password") return "اختر كلمة مرور مختلفة عن السابقة";
  return "حدث خطأ، حاول مرة أخرى";
}
