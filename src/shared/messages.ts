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
  SHOP_CLOSED: "الكوفي لا يستقبل طلبات الآن",
  FULFILLMENT_UNAVAILABLE: "طريقة الاستلام هذه غير متاحة حاليًا",
  EMPTY_ORDER: "السلة فارغة",
  ITEM_UNAVAILABLE: "أحد الأصناف في سلتك غير متوفر الآن",
  OPTION_REQUIRED: "اختر المحصول للقهوة المقطرة",
  OPTION_UNAVAILABLE: "المحصول اللي اخترته خلص، اختر محصولًا ثانيًا",
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
  PLACES_LIMIT: "تقدر تحفظ 5 عناوين بالكثير. احذف واحد عشان تضيف غيره",
  PLACE_KIND_TAKEN: "عندك عنوان محفوظ بهذا النوع. عدّله بدل ما تضيف واحد ثاني",
  NOT_COMPLETED: "تقدر تقيّم الطلب بعد ما تستلمه",
  ALREADY_RATED: "قيّمت هذا الطلب من قبل، شكرًا لك",
  BROADCAST_TOO_SOON: "أرسلت إشعارًا قبل أقل من 10 دقائق، انتظر شوي قبل الإرسال مرة ثانية",
  NO_RECIPIENTS: "ما فيه أحد مفعّل إشعارات العروض حتى الآن",
  INTERNAL: "حدث خطأ غير متوقع، حاول مرة أخرى",
};

/** English messages for the customer screens (staff screens stay Arabic). */
export const ERROR_MESSAGES_EN: Record<string, string> = {
  UNAUTHENTICATED: "Please sign in",
  FORBIDDEN: "You don't have permission to do that",
  EMAIL_NOT_CONFIRMED: "Please confirm your email first",
  NOT_FOUND: "Not found",
  INVALID_REQUEST: "Some of the details aren't valid",
  MEMBERSHIP_CANCELLED: "This membership is cancelled",
  NO_REWARD: "No free drink available",
  IDEMPOTENCY_CONFLICT: "Something clashed with another request, please try again",
  RATE_LIMITED: "Too many attempts, wait a moment and try again",
  PAYLOAD_TOO_LARGE: "The request is too large",
  WALLET_MOCK_MODE: "Adding the card to Apple Wallet isn't available right now",
  WALLET_NOT_CONFIGURED: "Apple Wallet isn't set up right now",
  WALLET_SIGNING_FAILED: "We couldn't create your Apple Wallet card right now",
  LINK_EXPIRED: "The link has expired, please try again",
  EMAIL_EXISTS: "This email is already registered",
  CONFIG_ERROR: "The service isn't fully set up",
  SHOP_CLOSED: "We're not taking orders right now",
  FULFILLMENT_UNAVAILABLE: "This pickup option isn't available right now",
  EMPTY_ORDER: "Your cart is empty",
  ITEM_UNAVAILABLE: "Something in your cart isn't available right now",
  OPTION_REQUIRED: "Choose an origin for your pour-over",
  OPTION_UNAVAILABLE: "That origin just ran out, please choose another",
  TOO_MANY_ITEMS: "That's more items than one order allows",
  BELOW_MINIMUM: "The order is below the delivery minimum",
  REWARD_NEEDS_DRINK: "Add a drink to use your free drink",
  REWARD_IN_USE: "Your free drink is already on another open order",
  INVALID_TRANSITION: "That can't be done for this order now",
  INVALID_PHONE: "Invalid mobile number (e.g. 0512345678)",
  ORDER_NOT_FOUND: "Order not found",
  ACTIVE_ORDER: "You have an order being prepared or delivered. Delete your account after you receive it",
  PLACES_LIMIT: "You can save up to 5 places. Delete one to add another",
  PLACE_KIND_TAKEN: "You already have a place of this type. Edit it instead",
  NOT_COMPLETED: "You can rate the order once you've received it",
  ALREADY_RATED: "You already rated this order, thank you",
  NETWORK: "Couldn't reach the server, check your connection",
  INTERNAL: "Something went wrong, please try again",
};

export function errorMessageEn(code: string): string {
  return ERROR_MESSAGES_EN[code] ?? ERROR_MESSAGES_EN.INTERNAL!;
}

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
