# HOLLOW email links — production activation

Implemented: native signup/recovery requests use an HTTPS Universal Link at
`/auth/callback`. Installed apps validate the link, create the Supabase session
and open the customer destination (recovery always opens `/reset-password`).
The handler covers cold launch and an already-open app, rejects unrelated
origins/paths, and deduplicates successful links across route/language remounts.
Credentials are never logged or placed in URL query strings.

If iOS/mail keeps the redirect in Safari, the callback page offers **فتح في التطبيق**
using the existing `hollowcoffee` scheme, and **المتابعة بالموقع**. Without the app,
the latter completes the same task on the website. Normal requests originating
on the website keep their existing redirects. The callback page strips the
credential fragment from browser history and holds it only in memory until the
user chooses; reloading that page may require a fresh email link.

## Required external configuration (not performed by a code push)

1. Supabase → Authentication → URL Configuration → Redirect URLs: add

   ```text
   https://hollow-rewards.hollowzulfi.workers.dev/auth/callback**
   ```

   Keep all existing web redirects and Site URL. The callback path is restricted
   by the app; do not allow arbitrary external domains. The configured email
   templates must use Supabase's `ConfirmationURL` or otherwise preserve the
   supplied RedirectTo, not hard-code only the Site URL. No template change is
   required when using Supabase's default templates. This feature does not turn
   email confirmation on or off or change server confirmation requirements.
2. Deploy the website before installing a newly built app. Check the following
   public URL returns HTTP 200, `application/json`, the actual JSON (not index.html),
   and no redirect:

   ```text
   https://hollow-rewards.hollowzulfi.workers.dev/.well-known/apple-app-site-association
   ```

   It authorizes only `/auth/callback` for `N2KXQ7MVY3.com.hollowzulfi.coffee`.
   Confirm that prefix against the distribution profile's application-identifier.
   Any future custom domain needs its own association file and entitlement.
3. Build through **iOS TestFlight**. The signing script enables Associated Domains
   on the main App ID and regenerates its existing distribution profile if that
   entitlement is missing; it leaves the widget capability list unchanged. The
   configured Apple API key must be permitted to manage bundle capabilities/profiles.
   Permission errors are surfaced, not bypassed. Do not run iOS setup again merely
   for this feature or replace the distribution certificate unnecessarily.
4. Check the final signed app includes the Associated Domains entitlement. Install
   or reinstall the new TestFlight build after the association file is live.
   Apple's association cache can delay activation; pasting a link in Safari's
   address bar is not a reliable test of opening a Universal Link.

## Physical-device acceptance

Use disposable accounts and real email links; never share a link containing
credentials in logs, screenshots, issues or chat.

- Request confirmation from the app (if confirmation is enabled in Supabase).
  Open Mail's link with the app closed, then with it open. Verify sign-in returns
  to the cart when signup started there, otherwise the wallet.
- Request password recovery from the app; verify the new-password form, password
  update, and login using the new password. Existing passwords must stop working.
- Open a native-origin email on a phone with no app, choose website, and complete
  the flow there. Also test the normal website-origin signup/reset links.
- If Mail stays in Safari, test both explicit buttons. Test expired/used/malformed
  links, unrelated hosts, cancellation and offline/retry without exposing tokens.
- After completion, change language or navigate to another page: the consumed
  email link must not re-open or sign someone back in after logout.
- With widgets enabled, sign out during a delayed refresh and switch A → B. The
  widget must remain empty after logout and must never show A after B signs in.

Unit tests cover URL validation/redirects and widget races. End-to-end Mail,
Apple association caching, signed entitlements and on-device behavior require
the production setup and physical-device checks above; they are not proven by
a TypeScript build or simulator compilation.
