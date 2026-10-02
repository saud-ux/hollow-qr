# Apple Wallet

## What is implemented

- **Store card** `pass.json` (`formatVersion`, `passTypeIdentifier`, `teamIdentifier`, `serialNumber`, `organizationName`, `description`, colors, `logoText`, `barcodes`, `webServiceURL`, `authenticationToken`, `sharingProhibited`, `voided`, `storeCard` fields). See `src/server/wallet/pass-content.ts`.
- **Images**: `icon`, `logo` and `strip` at @1x/@2x/@3x, pre-rendered for every state: 0–5 cups, reward (5/5) and cancelled.
  Apple Wallet does not allow free placement of five icons, so the cups live in the store-card **strip image** (375×144 pt).
  This is the legitimate equivalent. Regenerate them with `pnpm assets:generate`.
- **Signing**: `manifest.json` (SHA-1 of every file) plus a detached PKCS#7 `signature` (SHA-256, signer certificate + WWDR certificate, signing time).
  Signing uses PKI.js and native WebCrypto, and takes about 5 ms per pass in workerd. Served as `application/vnd.apple.pkpass`.
- **Web service** (`src/server/routes/wallet-service.ts`), following Apple's current *Adding a Web Service to Update Passes*:
  - `POST/DELETE /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}/{serialNumber}` (201/200/401)
  - `GET /v1/devices/{deviceLibraryIdentifier}/registrations/{passTypeIdentifier}?passesUpdatedSince=` (200/204)
  - `GET /v1/passes/{passTypeIdentifier}/{serialNumber}` (200/304/401, `Last-Modified` / `If-Modified-Since`)
  - `POST /v1/log`
- **Tokens**:
  - `authenticationToken` = HMAC-SHA256(`PASS_AUTH_SECRET`, serial). It is stable, never stored, and checked in constant time from `Authorization: ApplePass <token>`.
  - The QR carries `https://<domain>/c/<random-id>.<HMAC>`: no email, name or database UUID.
- **Update pushes**: after every loyalty change the Worker looks up the registered devices and sends APNs a `POST /3/device/<pushToken>` request.
  The request carries `apns-topic: <passTypeIdentifier>` and the payload `{}`, and goes through the `APPLE_APNS_MTLS` mTLS binding.
  Invalid tokens (410 / `BadDeviceToken`) delete the device registration.
- Serial number and auth token never change between updates. Cancelling a membership re-issues the pass with `voided: true`.

## Mock mode (`APPLE_WALLET_MODE=mock`, the default)

- Sign-up, the card, the QR and staff scanning all work. `/wallet` shows a realistic **preview** labelled as development mode.
- No `.pkpass` is offered. Unsigned passes cannot be installed, and the app does not pretend otherwise.
- Wallet refreshes are logged (`wallet.mock_push`) instead of being sent.
- `GET /api/wallet/pass-json` (development only) shows the exact `pass.json` that production would sign.

## What you need from Apple (Apple Developer Program membership)

1. **Team ID**: Membership page → `APPLE_TEAM_IDENTIFIER`.
2. **Pass Type ID**: Certificates, Identifiers & Profiles → Identifiers → **+** → *Pass Type IDs* (e.g. `pass.sa.hollow.rewards`) → `APPLE_PASS_TYPE_IDENTIFIER`.
3. **Pass Type ID certificate**:
   - **Windows / any OS:** run `pnpm secrets:csr --email you@example.com`.
     It writes `.secrets/pass-key.pem` (keep it safe) and `.secrets/pass.csr`.
   - **Mac alternative:** Keychain Access → Certificate Assistant → *Request a Certificate From a Certificate Authority* (saved to disk).
   - Apple Developer → Certificates → **+** → *Pass Type ID Certificate* → choose the Pass Type ID → upload the CSR → download `pass.cer`.
   - Mac only: you can instead double-click the `.cer` and export certificate + key as a `.p12` from Keychain.
4. **Apple WWDR intermediate certificate**: download the *Worldwide Developer Relations* intermediate that issued your certificate (currently **G4**) from Apple PKI (https://www.apple.com/certificateauthority/).

## Switching mock → production

```bash
# 1. Convert the certificates (writes git-ignored .secrets/, prints the exact next commands)
pnpm secrets:encode --cert pass.cer --key .secrets/pass-key.pem --wwdr AppleWWDRCAG4.cer   # Windows / any OS
pnpm secrets:encode --p12 PassTypeID.p12 --wwdr AppleWWDRCAG4.cer                          # Mac Keychain export

# 2. Signing secrets (works in PowerShell, cmd and bash)
node -e "process.stdout.write(require('fs').readFileSync('.secrets/APPLE_PASS_CERTIFICATE_BASE64.b64','utf8'))" | npx wrangler secret put APPLE_PASS_CERTIFICATE_BASE64
node -e "process.stdout.write(require('fs').readFileSync('.secrets/APPLE_PASS_PRIVATE_KEY_BASE64.b64','utf8'))" | npx wrangler secret put APPLE_PASS_PRIVATE_KEY_BASE64
node -e "process.stdout.write(require('fs').readFileSync('.secrets/APPLE_WWDR_CERTIFICATE_BASE64.b64','utf8'))" | npx wrangler secret put APPLE_WWDR_CERTIFICATE_BASE64

# 3. APNs mTLS certificate for update pushes (same Pass Type ID cert + key)
npx wrangler mtls-certificate upload --cert .secrets/pass-cert.pem --key .secrets/pass-key.pem --name hollow-apns
#    -> copy the returned certificate ID into wrangler.jsonc:
#       "mtls_certificates": [{ "binding": "APPLE_APNS_MTLS", "certificate_id": "<ID>" }]

# 4. wrangler.jsonc vars
#    "APPLE_WALLET_MODE": "production",
#    "APPLE_TEAM_IDENTIFIER": "<TEAM ID>",
#    "APPLE_PASS_TYPE_IDENTIFIER": "pass.sa.hollow.rewards"

# 5. Deploy. Keep a backup of .secrets/pass-key.pem in a password manager, then delete .secrets/
pnpm run deploy
```

`/api/health` should now report `"walletMode":"production","walletReady":true`.

Notes:
- If the key is encrypted, keep it PBES2 (`openssl pkcs8 -topk8 -v2 aes-256-cbc`) and set `APPLE_PASS_PRIVATE_KEY_PASSPHRASE`.
  Unencrypted PKCS#8 (what `secrets:encode` writes) is simpler. Worker secrets are already encrypted at rest.
- The Worker checks at load time that the certificate's UID and OU match the configured Pass Type ID and Team ID, and that neither certificate has expired.
  Errors are logged by name only. Responses say `WALLET_SIGNING_FAILED` and never include certificate details.
- Pass update pushes work only in Apple's **production** APNs environment, which is the only one used.
- The certificate expires yearly. Renew it, re-run steps 1–3 and redeploy.
  Existing passes keep working because the serial number and auth token do not change.

## Verifying on a real iPhone

1. Open `https://<domain>/wallet` in Safari, sign in and tap **Add to Apple Wallet**.
2. The pass should show the HOLLOW logo, the customer name, `0 / 5 Cups` and the QR with *SCAN AT CHECKOUT*.
3. On the back of the pass, *Automatic Updates* should be on (the device registered at `/v1/devices/...`).
4. Add cups from `/staff`. The pass should refresh within seconds.
   On the 5th cup it shows `5 / 5 Cups` and **لك مشروب مجاني**, plus a lock-screen notice from `changeMessage`.
5. If nothing updates, check the Worker logs for `wallet.push_summary`, `apns.push_failed` and `wallet.device_log`.
   Devices also post their own errors to `/v1/log`.

## "Add to Apple Wallet" badge

Apple requires its official badge artwork. Download the Arabic badge from Apple's *Add to Apple Wallet* guidelines and save it as `public/apple-wallet/add-to-apple-wallet-ar.svg`.
The button uses it automatically. Until then a plain black "Add to Apple Wallet" button is shown, with no imitation of Apple's artwork.

## Known platform limits

- Wallet controls fonts and layout. Field placement on the real pass can differ slightly from the web preview.
- The cups are an image (strip), so they are not read by VoiceOver. The textual `3 / 5 Cups` field is.
- Workers mTLS bindings run only on Cloudflare's network. In local `wrangler dev` there is no binding, so pushes are logged instead.
