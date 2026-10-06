import type { ReactNode } from "react";
import { CustomerLayout } from "../../components/CustomerLayout";

export const SUPPORT_EMAIL = "hollowcoffee.sa@gmail.com";
const UPDATED = "2026-10-06";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="card info__section">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

const mail = <a href={`mailto:${SUPPORT_EMAIL}`} dir="ltr">{SUPPORT_EMAIL}</a>;

/** Privacy policy (App Store "Privacy Policy URL"): /privacy */
export function PrivacyPage() {
  return (
    <CustomerLayout>
      <article className="info">
        <h1 className="page-title">سياسة الخصوصية</h1>
        <p className="muted small">
          آخر تحديث: <span dir="ltr">{UPDATED}</span>
        </p>

        <Section title="من نحن">
          <p>HOLLOW كوفي في الزلفي. هذه السياسة تشرح البيانات التي نجمعها في موقعنا وتطبيق HOLLOW Coffee، ولماذا، وكيف تحذفها.</p>
        </Section>
        <Section title="البيانات التي نجمعها">
          <ul>
            <li>الحساب: الاسم والبريد الإلكتروني وكلمة المرور (محفوظة مشفّرة لدى مزوّد تسجيل الدخول).</li>
            <li>الطلبات: الأصناف، رقم الجوال، وصف السيارة عند الاستلام من السيارة، وعنوان التوصيل.</li>
            <li>الموقع: فقط إذا ضغطت «استخدم موقعي» لتحديد عنوان التوصيل، مرة واحدة، ولا نتتبعك.</li>
            <li>بطاقة الولاء: عدد الأكواب والمكافآت وسجل العمليات.</li>
            <li>الإشعارات: رمز الجهاز الذي تعطيه Apple، لنرسل لك حالة طلبك فقط.</li>
          </ul>
        </Section>
        <Section title="لماذا نستخدمها">
          <p>لتجهيز طلبك وتسليمه، والتواصل معك بخصوصه، وإدارة بطاقة الولاء. لا نستخدم بياناتك للإعلانات، ولا نتتبعك عبر تطبيقات أو مواقع أخرى، ولا نبيعها لأحد.</p>
        </Section>
        <Section title="من يعالجها نيابة عنّا">
          <ul>
            <li>Supabase: قاعدة البيانات وتسجيل الدخول.</li>
            <li>Cloudflare: استضافة الموقع والخادم.</li>
            <li>Apple: إيصال الإشعارات وتحديث بطاقة Apple Wallet.</li>
          </ul>
        </Section>
        <Section title="الدفع">
          <p>الدفع حاليًا عند الاستلام، ولا نجمع أو نحفظ أي بيانات بطاقات بنكية.</p>
        </Section>
        <Section title="حذف حسابك">
          <p>
            من التطبيق أو الموقع: «بطاقتي» ثم «حذف الحساب». نحذف اسمك وبريدك وأرقامك وعناوينك ورموز أجهزتك، ونلغي بطاقتك. نحتفظ
            بسجلات الطلبات والمبيعات بعد إزالة بياناتك الشخصية منها لأغراض محاسبية. أو راسلنا على {mail}.
          </p>
        </Section>
        <Section title="تواصل معنا">
          <p>لأي سؤال عن خصوصيتك: {mail}</p>
        </Section>

        <div dir="ltr" lang="en" className="info__en">
          <h1 className="page-title">Privacy Policy</h1>
          <Section title="Who we are">
            <p>HOLLOW is a café in Al Zulfi, Saudi Arabia. This policy covers our website and the HOLLOW Coffee app.</p>
          </Section>
          <Section title="What we collect">
            <ul>
              <li>Account: name, email and password (stored hashed by our sign-in provider).</li>
              <li>Orders: items, mobile number, car description for curbside pickup, delivery address.</li>
              <li>Location: only when you tap "use my location" to fill a delivery address, once. No tracking.</li>
              <li>Loyalty card: cups, rewards and their history.</li>
              <li>Notifications: the device token Apple provides, used only for order status updates.</li>
            </ul>
          </Section>
          <Section title="How we use it">
            <p>To prepare and hand over your order, contact you about it, and run the loyalty card. No advertising, no cross-app tracking, and we never sell your data.</p>
          </Section>
          <Section title="Service providers">
            <p>Supabase (database and sign-in), Cloudflare (hosting), Apple (notifications and Apple Wallet updates).</p>
          </Section>
          <Section title="Payments">
            <p>You currently pay on pickup. We do not collect or store card details.</p>
          </Section>
          <Section title="Deleting your account">
            <p>
              In the app or website: My card, then Delete account. We remove your name, email, phone numbers, addresses and device tokens and
              cancel your card. Order and sales records are kept for accounting with your personal data removed. Or email {mail}.
            </p>
          </Section>
          <Section title="Contact">
            <p>{mail}</p>
          </Section>
        </div>
      </article>
    </CustomerLayout>
  );
}

/** Support page (App Store "Support URL"): /support */
export function SupportPage() {
  return (
    <CustomerLayout>
      <article className="info">
        <h1 className="page-title">الدعم والمساعدة</h1>
        <Section title="تواصل معنا">
          <p>راسلنا على {mail} ونرد عليك في أقرب وقت.</p>
        </Section>
        <Section title="أسئلة شائعة">
          <dl>
            <dt>كيف أطلب؟</dt>
            <dd>اختر من المنيو، ثم السلة، ثم اختر الاستلام من الكاشير أو من السيارة أو التوصيل.</dd>
            <dt>كيف أدفع؟</dt>
            <dd>الدفع عند الاستلام.</dd>
            <dt>كيف أعرف أن طلبي جاهز؟</dt>
            <dd>تتابع حالة الطلب في «طلباتي»، ويوصلك إشعار إذا سمحت بالإشعارات في التطبيق.</dd>
            <dt>بطاقة الولاء؟</dt>
            <dd>كل مشروب يضيف كوبًا لبطاقتك، وبعد 5 أكواب السادس مجاني.</dd>
            <dt>كيف أحذف حسابي؟</dt>
            <dd>«بطاقتي» ثم «حذف الحساب».</dd>
          </dl>
        </Section>

        <div dir="ltr" lang="en" className="info__en">
          <h1 className="page-title">Support</h1>
          <Section title="Contact us">
            <p>Email {mail} and we will get back to you soon.</p>
          </Section>
          <Section title="FAQ">
            <dl>
              <dt>How do I order?</dt>
              <dd>Pick from the menu, open the cart, and choose counter pickup, curbside or delivery.</dd>
              <dt>How do I pay?</dt>
              <dd>Pay when you collect your order.</dd>
              <dt>How do I know my order is ready?</dt>
              <dd>Follow it under Orders. If you allow notifications in the app, we notify you.</dd>
              <dt>Loyalty card?</dt>
              <dd>Every drink adds a cup. After 5 cups, the sixth drink is free.</dd>
              <dt>How do I delete my account?</dt>
              <dd>My card, then Delete account.</dd>
            </dl>
          </Section>
        </div>
      </article>
    </CustomerLayout>
  );
}
