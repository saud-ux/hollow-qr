/**
 * Arabic, user-facing messages for API error codes. Codes are stable English
 * identifiers; only the UI text is Arabic.
 */
export const ERROR_MESSAGES_AR: Record<string, string> = {
  UNAUTHENTICATED: "يرجى تسجيل الدخول",
  FORBIDDEN: "ليس لديك صلاحية لهذا الإجراء",
  EMAIL_NOT_CONFIRMED: "يرجى تأكيد بريدك الإلكتروني أولًا",
  NOT_FOUND: "العميل غير موجود",
  INVALID_CODE: "رمز غير صالح أو غير معروف",
  INVALID_REQUEST: "البيانات المرسلة غير صحيحة",
  INVALID_QUANTITY: "عدد الأكواب غير صحيح",
  MEMBERSHIP_CANCELLED: "عضوية هذا العميل ملغاة وغير نشطة",
  RECENT_ACTIVITY: "تم تحديث هذا العميل قبل أقل من دقيقة",
  REWARD_PENDING: "لدى العميل مشروب مجاني متاح. استخدم المكافأة الحالية قبل بدء دورة جديدة",
  EXCEEDS_CAPACITY: "العدد المطلوب يتجاوز الحد الأقصى (5)",
  ALREADY_ZERO: "لا توجد أكواب لإزالتها",
  BELOW_ZERO: "لا يمكن أن يقل العدد عن صفر",
  NO_REWARD: "لا يوجد مشروب مجاني متاح",
  NOTHING_TO_UNDO: "لا توجد عملية يمكن التراجع عنها",
  UNDO_STATE_MISMATCH: "تغيّر رصيد العميل بعد آخر عملية، لا يمكن التراجع تلقائيًا",
  NO_CHANGE: "لا يوجد تغيير",
  ALREADY_ACTIVE: "العضوية نشطة بالفعل",
  IDEMPOTENCY_CONFLICT: "تعارض في الطلب، أعد المحاولة",
  RATE_LIMITED: "محاولات كثيرة، انتظر قليلًا ثم أعد المحاولة",
  PAYLOAD_TOO_LARGE: "الطلب كبير جدًا",
  WALLET_MOCK_MODE: "إضافة البطاقة إلى Apple Wallet غير متاحة حاليًا",
  WALLET_NOT_CONFIGURED: "Apple Wallet غير مهيأ حاليًا",
  WALLET_SIGNING_FAILED: "تعذّر إنشاء بطاقة Apple Wallet حاليًا",
  LINK_EXPIRED: "انتهت صلاحية الرابط، أعد المحاولة",
  EMAIL_EXISTS: "هذا البريد مسجل مسبقًا",
  CONFIG_ERROR: "الخدمة غير مهيأة بالكامل",
  SHOP_CLOSED: "المقهى لا يستقبل طلبات الآن",
  FULFILLMENT_UNAVAILABLE: "طريقة الاستلام هذه غير متاحة حاليًا",
  EMPTY_ORDER: "السلة فارغة",
  ITEM_UNAVAILABLE: "أحد الأصناف في سلتك غير متوفر الآن",
  TOO_MANY_ITEMS: "عدد الأصناف أكبر من المسموح",
  BELOW_MINIMUM: "قيمة الطلب أقل من الحد الأدنى للتوصيل",
  REWARD_NEEDS_DRINK: "أضف مشروبًا لاستخدام مشروبك المجاني",
  REWARD_IN_USE: "مشروبك المجاني مستخدم في طلب آخر لم يكتمل",
  INVALID_TRANSITION: "لا يمكن تنفيذ هذا الإجراء على الطلب الآن",
  INVALID_PHONE: "رقم الجوال غير صحيح (مثال: 0512345678)",
  ORDER_NOT_FOUND: "الطلب غير موجود",
  IMAGE_INVALID: "الصورة غير صالحة. استخدم JPG أو PNG أو WebP",
  IMAGE_TOO_LARGE: "حجم الصورة أكبر من 2 ميجابايت",
  ACTIVE_ORDER: "عندك طلب قيد التحضير أو التوصيل. احذف حسابك بعد استلامه",
  INTERNAL: "حدث خطأ غير متوقع، حاول مرة أخرى",
};

export function errorMessageAr(code: string, fallback?: string): string {
  return ERROR_MESSAGES_AR[code] ?? fallback ?? ERROR_MESSAGES_AR.INTERNAL!;
}

export const ACTION_LABELS_AR: Record<string, string> = {
  ADD_CUPS: "إضافة أكواب",
  REMOVE_CUPS: "إزالة كوب",
  REDEEM_REWARD: "استخدام المشروب المجاني",
  UNDO: "تراجع",
  CANCEL_MEMBERSHIP: "إلغاء العضوية",
  REACTIVATE_MEMBERSHIP: "إعادة تفعيل العضوية",
  ADMIN_ADJUSTMENT: "تعديل إداري",
};

export const ROLE_LABELS_AR: Record<string, string> = {
  customer: "عميل",
  staff: "موظف",
  admin: "مدير",
};
