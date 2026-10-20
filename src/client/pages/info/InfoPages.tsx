import type { ReactNode } from "react";
import { currentLang } from "../../lib/i18n";
import { BackButton } from "../../components/BackButton";
import { CustomerLayout } from "../../components/CustomerLayout";

export const SUPPORT_EMAIL = "hollowcoffee.sa@gmail.com";
const UPDATED = "2026-10-20";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card info__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const mail = (
  <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr">
    {SUPPORT_EMAIL}
  </a>
);

/** Privacy policy (App Store "Privacy Policy URL"): /privacy */
export function PrivacyPage() {
  const en = currentLang() === "en";
  return (
    <CustomerLayout>
      <BackButton />
      <article className="info">
        {en ? (
          <div lang="en">
            <h1 className="page-title">Privacy Policy</h1>
            <p className="muted small">Last updated: {UPDATED}</p>
            <Section title="Who we are">
              <p>
                HOLLOW is a café in Al Zulfi, Saudi Arabia. This policy covers
                our website and the HOLLOW Coffee app.
              </p>
            </Section>
            <Section title="What we collect">
              <ul>
                <li>
                  Account: name, email and password (stored hashed by our
                  sign-in provider).
                </li>
                <li>
                  Orders: items, mobile number, car description for curbside
                  pickup, delivery address.
                </li>
                <li>
                  Delivery location: when you choose to use your location or
                  save an address, we receive the address and coordinates to
                  deliver your order. You can enter an address manually instead.
                </li>
                <li>Loyalty card: cups, rewards and their history.</li>
                <li>Credit and gifts: balance, gifted cups, coupon use and transaction history.</li>
                <li>
                  Notifications: the device token Apple provides, for order
                  status updates, and offers only if you turn them on under Account → Notifications.
                </li>
                <li>
                  Ratings: your stars and optional comment on a completed order.
                  The comment is deleted if you delete your account.
                </li>
              </ul>
            </Section>
            <Section title="Optional nearby alerts">
              <p>
                If you turn on nearby alerts, iOS monitors whether your phone
                enters a 300-metre area around HOLLOW, including in the background
                with Always location permission. While the café is open, it can
                show a local invitation at most once every 12 hours. This monitoring
                stays on your phone: we do not upload your location or a history
                of your movements for nearby alerts. This is separate from delivery
                coordinates you choose to send with an order or saved address.
              </p>
              <p>
                You can turn nearby alerts off in Account → Settings → Notifications,
                even without signing in, or revoke location/notification permission
                in iOS Settings. Nearby alerts and notifications are optional;
                refusing them does not prevent browsing or ordering.
              </p>
            </Section>
            <Section title="How we use it">
              <p>
                To prepare and hand over your order, contact you about it, and
                run the loyalty card, credit and gift balances. Offers are opt-in,
                and nearby invitations have their own optional switch. We do not
                track you across other companies' apps or websites or sell your data.
              </p>
            </Section>
            <Section title="Service providers">
              <p>
                Supabase (database and sign-in), Cloudflare (hosting), Apple
                (notifications, Apple Wallet and home/lock-screen widgets). The
                widget stores a limited read-only credential in the shared iOS
                Keychain to refresh your card and order; signing out clears it.
              </p>
              <p>
                Optional address maps use OpenStreetMap tiles and Nominatim address
                lookup. These services receive your IP address and the map area or
                coordinates you look up. This is separate from on-device nearby alerts.
                Moyasar processes balance top-ups when enabled.
              </p>
            </Section>
            <Section title="Payments">
              <p>
                Orders currently use payment on pickup/delivery. Online methods
                marked Coming soon are unavailable. If balance top-ups are enabled,
                Moyasar processes payment on its checkout; we receive transaction
                identifiers, amounts and payment status, not full card details.
              </p>
            </Section>
            <Section title="Deleting your account">
              <p>
                In the app or website: Account, then Delete account. We remove
                your personal account/contact data, saved places, comments and app
                notification registrations, cancel the loyalty card, and permanently
                delete your sign-in account. You cannot use your credit or gifted
                cups in the app afterwards. Financial balances and records are not
                silently erased or automatically refunded; contact {mail} about any
                financial claim. No support call is needed to request account deletion.
              </p>
              <p>
                Sign-in deletion is retried automatically if our provider is
                unavailable, normally within 24 hours. An order already being prepared
                or delivered must finish or be cancelled before deletion, as its
                contact details are needed for fulfilment. Remembered contact and cart
                data on this device are cleared and nearby alerts stop on deletion.
              </p>
            </Section>
            <Section title="Retention and choices">
              <p>
                Active account data is retained to provide your service. After deletion,
                anonymized order, loyalty and financial records are kept for accounting,
                fraud prevention and resolving claims for as long as required for
                those purposes or applicable retention requirements. Wallet registration
                identifiers may remain so an existing pass can update to cancelled;
                Wallet removes its registration when the pass is removed. You can delete
                saved places and turn off offers or nearby alerts in account settings.
              </p>
            </Section>
            <Section title="Contact">
              <p>{mail}</p>
            </Section>
          </div>
        ) : (
          <>
            <h1 className="page-title">سياسة الخصوصية</h1>
            <p className="muted small">
              آخر تحديث: <span dir="ltr">{UPDATED}</span>
            </p>

            <Section title="من نحن">
              <p>
                HOLLOW كوفي في الزلفي. هذه السياسة تشرح البيانات التي نجمعها في
                موقعنا وتطبيق HOLLOW Coffee، ولماذا، وكيف تحذفها.
              </p>
            </Section>
            <Section title="البيانات التي نجمعها">
              <ul>
                <li>
                  الحساب: الاسم والبريد الإلكتروني وكلمة المرور (محفوظة مشفّرة
                  لدى مزوّد تسجيل الدخول).
                </li>
                <li>
                  الطلبات: الأصناف، رقم الجوال، وصف السيارة عند الاستلام من
                  السيارة، وعنوان التوصيل.
                </li>
                <li>
                  موقع التوصيل: إذا اخترت استخدام موقعك أو حفظ عنوان، نستقبل
                  العنوان والإحداثيات لتوصيل الطلب. يمكنك إدخال العنوان يدويًا بدلًا من ذلك.
                </li>
                <li>بطاقة الولاء: عدد الأكواب والمكافآت وسجل العمليات.</li>
                <li>الرصيد والهدايا: الرصيد المالي وأكواب الهدايا واستخدام الكوبونات وسجل العمليات.</li>
                <li>
                  الإشعارات: رمز الجهاز الذي تعطيه Apple، لنرسل لك حالة طلبك،
                  والعروض فقط إذا فعّلتها بنفسك من «حسابي».
                </li>
                <li>
                  التقييم: النجوم وملاحظتك (اختيارية) على الطلب بعد استلامه.
                  تُحذف الملاحظة إذا حذفت حسابك.
                </li>
              </ul>
            </Section>
            <Section title="تنبيهات القرب الاختيارية">
              <p>
                إذا فعّلت تنبيهات القرب، يراقب iOS دخول جوالك نطاقًا قدره ٣٠٠ متر
                حول هولو، بما في ذلك في الخلفية عند السماح بالموقع «دائمًا».
                عندما يكون المقهى مفتوحًا، قد يظهر تنبيه يدعوك لزيارتنا بحد أقصى
                مرة كل ١٢ ساعة. مراقبة القرب تبقى على جوالك؛ لا نرفع موقعك أو
                سجل تحركاتك لهذا الغرض. هذا مختلف عن إحداثيات التوصيل التي
                تختار إرسالها مع الطلب أو العنوان المحفوظ.
              </p>
              <p>
                تستطيع إيقافها من «حسابي ← الإعدادات ← الإشعارات» حتى دون تسجيل
                الدخول، أو إلغاء إذن الموقع والإشعارات من إعدادات iOS.
                الموقع وتنبيهات القرب والإشعارات اختيارية، ورفضها لا يمنع تصفح المنيو أو الطلب.
              </p>
            </Section>
            <Section title="لماذا نستخدمها">
              <p>
                لتجهيز طلبك وتسليمه والتواصل معك وإدارة بطاقة الولاء والرصيد والهدايا.
                العروض اختيارية بموافقتك، ولدعوات القرب مفتاح اختياري مستقل.
                لا نتتبعك عبر تطبيقات أو مواقع شركات أخرى، ولا نبيع بياناتك.
              </p>
            </Section>
            <Section title="من يعالجها نيابة عنّا">
              <ul>
                <li>Supabase: قاعدة البيانات وتسجيل الدخول.</li>
                <li>Cloudflare: استضافة الموقع والخادم.</li>
                <li>Apple: الإشعارات وApple Wallet وودجت الشاشة وتتبع الطلب على شاشة القفل.
                  يُحفظ مفتاح محدود للقراءة في سلسلة مفاتيح iOS لتحديث الودجت، ويُمسح عند الخروج.</li>
                <li>OpenStreetMap وNominatim: عرض خريطة العنوان الاختيارية والبحث عن
                  عنوان الإحداثيات؛ تستقبل هذه الخدمات عنوان الإنترنت ومنطقة الخريطة
                  أو الإحداثيات التي تبحث عنها، بشكل منفصل عن تنبيهات القرب المحلية.</li>
                <li>ميسر: معالجة شحن الرصيد إذا كانت الخدمة مفعّلة.</li>
              </ul>
            </Section>
            <Section title="الدفع">
              <p>
                الدفع للطلبات حاليًا عند الاستلام أو التوصيل. طرق الدفع المعروضة
                بعبارة «قريبًا» غير مفعّلة. إذا فُعّل شحن الرصيد، تعالج ميسر الدفع
                في صفحة الدفع التابعة لها، ونستقبل معرف العملية والمبلغ وحالة الدفع،
                دون تفاصيل البطاقة البنكية الكاملة.
              </p>
            </Section>
            <Section title="حذف حسابك">
              <p>
                من التطبيق أو الموقع: «حسابي» ثم «حذف الحساب». نزيل بيانات الحساب
                والتواصل والعناوين والتعليقات وتسجيلات إشعارات التطبيق، ونلغي بطاقة
                الولاء ونحذف حساب تسجيل الدخول نهائيًا. لن تتمكن من استخدام الرصيد
                أو أكواب الهدايا داخل التطبيق بعد الحذف. لا نمسح الرصيد والسجلات
                المالية بصمت ولا نصدر استردادًا تلقائيًا؛ لأي حقوق مالية راسل {mail}.
                لا تحتاج إلى التواصل مع الدعم لطلب حذف الحساب.
              </p>
              <p>
                نعيد محاولة حذف تسجيل الدخول تلقائيًا إذا تعذّر الاتصال بالمزوّد،
                وعادةً تكتمل المعالجة خلال ٢٤ ساعة. إذا كان طلبك قيد التحضير أو التوصيل،
                يلزم اكتماله أو إلغاؤه أولًا لأن بيانات التواصل لازمة لتنفيذه.
                عند الحذف تُمسح بيانات التواصل والسلة المتذكّرة على هذا الجهاز وتتوقف تنبيهات القرب.
              </p>
            </Section>
            <Section title="الاحتفاظ والخيارات المتاحة">
              <p>
                نحتفظ ببيانات الحساب النشط لتقديم الخدمة. بعد الحذف تبقى سجلات
                الطلبات والولاء والسجلات المالية دون اسمك وبيانات التواصل للأغراض
                المحاسبية ومنع الاحتيال وتسوية المطالبات، ما دامت مطلوبة لهذه الأغراض
                أو لمتطلبات الاحتفاظ المطبقة. قد تبقى معرفات تسجيل Wallet لتحديث
                البطاقة الموجودة إلى «ملغاة»، ويزيل Wallet التسجيل عند إزالة البطاقة.
                يمكنك حذف العناوين المحفوظة وإيقاف العروض وتنبيهات القرب من الإعدادات.
              </p>
            </Section>
            <Section title="تواصل معنا">
              <p>لأي سؤال عن خصوصيتك: {mail}</p>
            </Section>
          </>
        )}
      </article>
    </CustomerLayout>
  );
}

/** Support page (App Store "Support URL"): /support */
export function SupportPage() {
  const en = currentLang() === "en";
  return (
    <CustomerLayout>
      <BackButton />
      <article className="info">
        {en ? (
          <div lang="en">
            <h1 className="page-title">Support</h1>
            <Section title="Contact us">
              <p>Email {mail} and we will get back to you soon.</p>
            </Section>
            <Section title="FAQ">
              <dl>
                <dt>How do I order?</dt>
                <dd>
                  Pick from the menu, open the cart, and choose counter pickup,
                  curbside or delivery.
                </dd>
                <dt>How do I pay?</dt>
                <dd>Pay when you collect your order.</dd>
                <dt>How do I know my order is ready?</dt>
                <dd>
                  Follow it under Orders. If you allow notifications in the app,
                  we notify you.
                </dd>
                <dt>Loyalty card?</dt>
                <dd>
                  Every paid drink adds a cup. After 5 cups, the sixth drink is free.
                </dd>
                <dt>How do I delete my account?</dt>
                <dd>Account, then Delete account.</dd>
              </dl>
            </Section>
          </div>
        ) : (
          <>
            <h1 className="page-title">الدعم والمساعدة</h1>
            <Section title="تواصل معنا">
              <p>راسلنا على {mail} ونرد عليك في أقرب وقت.</p>
            </Section>
            <Section title="أسئلة شائعة">
              <dl>
                <dt>كيف أطلب؟</dt>
                <dd>
                  اختر من المنيو، ثم السلة، ثم اختر الاستلام من الكاشير أو من
                  السيارة أو التوصيل.
                </dd>
                <dt>كيف أدفع؟</dt>
                <dd>الدفع عند الاستلام.</dd>
                <dt>كيف أعرف أن طلبي جاهز؟</dt>
                <dd>
                  تتابع حالة الطلب في «طلباتي»، ويوصلك إشعار إذا سمحت بالإشعارات
                  في التطبيق.
                </dd>
                <dt>بطاقة الولاء؟</dt>
                <dd>كل مشروب مدفوع يضيف كوبًا لبطاقتك، وبعد 5 أكواب السادس مجاني.</dd>
                <dt>كيف أحذف حسابي؟</dt>
                <dd>«حسابي» ثم «حذف الحساب».</dd>
              </dl>
            </Section>
          </>
        )}
      </article>
    </CustomerLayout>
  );
}
