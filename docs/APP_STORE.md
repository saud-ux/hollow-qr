# App Store listing: HOLLOW Coffee

Copy each field into App Store Connect → the app → the version page.
The primary language is Arabic; add English under "App Information → Localizable Information".

## App information

| Field | Value |
| --- | --- |
| Name | HOLLOW Coffee |
| Bundle ID | com.hollowzulfi.coffee |
| SKU | hollow-coffee-ios |
| Primary category | Food & Drink |
| Secondary category | Lifestyle |
| Age rating | 4+ (answer "None" to every question) |
| Price | Free |
| Support URL | https://hollow-rewards.hollowzulfi.workers.dev/support |
| Privacy Policy URL | https://hollow-rewards.hollowzulfi.workers.dev/privacy |
| Copyright | 2026 HOLLOW |
| Contact email | hollowcoffee.sa@gmail.com |

## Arabic (primary)

**Subtitle** (max 30)

```
اطلب قهوتك واجمع أكوابك
```

**Promotional text** (max 170)

```
اطلب من HOLLOW قبل ما توصل: استلام من الكاشير أو من سيارتك أو توصيل. كل مشروب يضيف كوب لبطاقتك، والسادس علينا.
```

**Description**

```
HOLLOW كوفي مختص في الزلفي. اطلب قهوتك من التطبيق وتابعها لحظة بلحظة.

• اطلب قبل ما توصل
استلم من الكاشير، أو من سيارتك بدون ما تنزل، أو خلّنا نوصلها لك.

• تعرف متى طلبك جاهز
يوصلك إشعار إذا بدأنا التحضير، وإذا صار جاهز، وإذا طلع لك المندوب.

• بطاقة HOLLOW للولاء
كل مشروب يضيف كوب لبطاقتك تلقائيًا. بعد 5 أكواب، السادس مجاني. أضف بطاقتك إلى Apple Wallet وتتحدث وحدها.

• الدفع عند الاستلام
بدون إدخال بطاقة بنكية.

المنيو: قهوة اليوم، V60 حار وبارد، ماتشا، كركديه، بابكا، كيك، وافل، وأكثر.
```

**Keywords** (max 100, comma separated, no spaces after commas)

```
قهوة,كوفي,مقهى,الزلفي,طلب,استلام,توصيل,بطاقة ولاء,قهوة مختصة,ماتشا,كركديه,حلويات,V60
```

**What's New** (version 1.0)

```
أول إصدار من تطبيق HOLLOW.
```

## English

**Subtitle**

```
Order ahead. Collect cups.
```

**Promotional text**

```
Order from HOLLOW before you arrive: counter pickup, curbside or delivery. Every drink adds a cup to your card, and the sixth is on us.
```

**Description**

```
HOLLOW is a specialty café in Al Zulfi. Order from the app and follow your order live.

• Order ahead
Pick up at the counter, get it brought to your car, or have it delivered.

• Know when it's ready
Get a notification when we start, when it's ready, and when the driver is on the way.

• HOLLOW loyalty card
Every drink adds a cup automatically. After 5 cups, your sixth drink is free. Add the card to Apple Wallet and it updates itself.

• Pay on pickup
No card details needed.

Menu: coffee of the day, hot and iced V60, matcha, hibiscus, babka, cakes, waffles and more.
```

**Keywords**

```
coffee,cafe,zulfi,order ahead,pickup,curbside,delivery,loyalty,specialty coffee,matcha,v60
```

**What's New**

```
First release of the HOLLOW app.
```

## Screenshots

Required: 6.9" iPhone (1320 × 2868), 3 to 10 images.
Suggested order: Menu → Cart (pickup options) → Order status → Loyalty card → Orders list.
Take them after menu photos are uploaded, from TestFlight on an iPhone 15 Pro Max/16 Pro Max (side button + volume up).
They can also be generated from the website at that exact size.

## App Privacy (the "nutrition label")

Tracking: **No**. Everything below is **linked to the user**, **not used for tracking**, and its purpose is **App Functionality** only.

| Category | Data type | Why |
| --- | --- | --- |
| Contact Info | Name, Email Address, Phone Number, Physical Address | Account, order handover, delivery |
| Location | Precise Location | Only if the customer taps "use my location" for a delivery address |
| User Content | Other User Content | Order notes, car description |
| Identifiers | User ID | Account |
| Purchases | Purchase History | Orders and loyalty cups |

Not collected: Health, Financial Info, Contacts, Browsing History, Search History, Diagnostics, Usage Data, Sensitive Info.
The push device token does not need declaring (Apple treats it as part of the service).

## Export compliance

Already answered in the build (`ITSAppUsesNonExemptEncryption = false`): the app uses only standard HTTPS.

## App Review information

Sign-in required: **Yes**. Create the demo account on the website before submitting and confirm its email:
use `hollowcoffee.sa+review@gmail.com`, which arrives in the same Gmail inbox.

**Notes** (paste in English):

```
HOLLOW Coffee is the ordering and loyalty app of HOLLOW, a café in Al Zulfi, Saudi Arabia.

Demo account
Email: hollowcoffee.sa+review@gmail.com
Password: (the one you set)

How to test
1. Browse the menu (no sign-in needed), add items, open the cart and sign in with the demo account.
2. Choose "استلام من الكاشير" (counter pickup), enter any Saudi mobile number such as 0512345678, and place the order. Payment is in person at pickup; there are no in-app payments.
3. Allow notifications when asked. Our staff move the order through Preparing → Ready → Completed from the café's order board, and each step sends a push notification. If you place an order outside opening hours, the app shows the shop as closed.
4. "حسابي" (Account) tab → "بطاقتي" (My card) shows the loyalty card. "Add to Apple Wallet" presents the native PKAddPassesViewController.
5. Account deletion: "حسابي" (Account) tab → "حذف الحساب" (Delete account) at the bottom of the page.
6. Saved places: "حسابي" (Account) → "عناويني" (My places). The map uses OpenStreetMap; location is asked for only when adding a place or tapping "Use my current location".

Native features: APNs order-status notifications, PassKit (Apple Wallet) loyalty pass, haptics.
Contact: hollowcoffee.sa@gmail.com
```

Before you press **Submit for Review**:

- Set opening hours wide (or confirm someone will be at the café) so the reviewer can order.
- Keep the order board open on the café's iPad/phone, and move any order named "App Review" through the steps.
