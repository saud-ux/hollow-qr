/**
 * PKCS#7 (CMS) detached signature of manifest.json, as required by Apple
 * Wallet, built with PKI.js and signed with native WebCrypto.
 *
 * Why not passkit-generator? We verified passkit-generator@3.6.1 does run
 * on Workers with nodejs_compat and produces valid signatures, but it signs
 * with node-forge's pure-JS RSA (~40 ms CPU per pass measured), which exceeds
 * the Workers Free plan's 10 ms CPU budget. Native WebCrypto RSA takes ~1 ms,
 * needs no nodejs_compat, and keeps the bundle small. Pass assembly is
 * isolated behind PassGenerator (see pkpass.ts) so the library can be swapped.
 */
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { certificateDer, decodeBase64Secret, SigningMaterialError } from "./pem";
import { importPassPrivateKey } from "./private-key";

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

let engineReady = false;
function ensureEngine() {
  if (engineReady) return;
  pkijs.setEngine("webcrypto", new pkijs.CryptoEngine({ name: "webcrypto", crypto: globalThis.crypto }));
  engineReady = true;
}

export interface SigningMaterial {
  signerCertificate: pkijs.Certificate;
  wwdrCertificate: pkijs.Certificate;
  privateKey: CryptoKey;
}

export interface SigningSecrets {
  APPLE_PASS_CERTIFICATE_BASE64?: string;
  APPLE_PASS_PRIVATE_KEY_BASE64?: string;
  APPLE_PASS_PRIVATE_KEY_PASSPHRASE?: string;
  APPLE_WWDR_CERTIFICATE_BASE64?: string;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function parseCertificate(name: string, der: Uint8Array): pkijs.Certificate {
  try {
    return pkijs.Certificate.fromBER(toArrayBuffer(der));
  } catch {
    throw new SigningMaterialError(`${name} is not a valid X.509 certificate`);
  }
}

export function certificateSubjectValue(cert: pkijs.Certificate, oid: string): string | null {
  const tv = cert.subject.typesAndValues.find((t) => t.type === oid);
  return tv ? String(tv.value.valueBlock.value) : null;
}

const OID_UID = "0.9.2342.19200300.100.1.1";
const OID_OU = "2.5.4.11";

// Per-isolate cache: importing keys/certs once per isolate, not per request.
let cache: { fingerprint: string; material: Promise<SigningMaterial> } | null = null;

export function loadSigningMaterial(
  secrets: SigningSecrets,
  expected: { passTypeIdentifier: string; teamIdentifier: string },
  now: Date = new Date(),
): Promise<SigningMaterial> {
  const fingerprint = [
    secrets.APPLE_PASS_CERTIFICATE_BASE64?.length,
    secrets.APPLE_PASS_CERTIFICATE_BASE64?.slice(-24),
    secrets.APPLE_PASS_PRIVATE_KEY_BASE64?.length,
    secrets.APPLE_PASS_PRIVATE_KEY_BASE64?.slice(-24),
    secrets.APPLE_WWDR_CERTIFICATE_BASE64?.slice(-24),
    expected.passTypeIdentifier,
    expected.teamIdentifier,
  ].join("|");
  if (cache?.fingerprint === fingerprint) return cache.material;

  const material = (async (): Promise<SigningMaterial> => {
    ensureEngine();
    const signerCertificate = parseCertificate(
      "APPLE_PASS_CERTIFICATE",
      certificateDer("APPLE_PASS_CERTIFICATE", decodeBase64Secret("APPLE_PASS_CERTIFICATE_BASE64", secrets.APPLE_PASS_CERTIFICATE_BASE64)),
    );
    const wwdrCertificate = parseCertificate(
      "APPLE_WWDR_CERTIFICATE",
      certificateDer("APPLE_WWDR_CERTIFICATE", decodeBase64Secret("APPLE_WWDR_CERTIFICATE_BASE64", secrets.APPLE_WWDR_CERTIFICATE_BASE64)),
    );
    const privateKey = await importPassPrivateKey(
      decodeBase64Secret("APPLE_PASS_PRIVATE_KEY_BASE64", secrets.APPLE_PASS_PRIVATE_KEY_BASE64),
      secrets.APPLE_PASS_PRIVATE_KEY_PASSPHRASE,
    );

    for (const [name, cert] of [
      ["APPLE_PASS_CERTIFICATE", signerCertificate],
      ["APPLE_WWDR_CERTIFICATE", wwdrCertificate],
    ] as const) {
      if (cert.notAfter.value.getTime() < now.getTime()) {
        throw new SigningMaterialError(`${name} has expired`);
      }
      if (cert.notBefore.value.getTime() > now.getTime()) {
        throw new SigningMaterialError(`${name} is not valid yet`);
      }
    }

    // Apple Pass Type ID certificates carry the pass type in UID and the team
    // in OU. Catch the most common misconfiguration early with a clear error.
    const uid = certificateSubjectValue(signerCertificate, OID_UID);
    if (uid && uid !== expected.passTypeIdentifier) {
      throw new SigningMaterialError("APPLE_PASS_CERTIFICATE does not match APPLE_PASS_TYPE_IDENTIFIER");
    }
    const ou = certificateSubjectValue(signerCertificate, OID_OU);
    if (ou && ou !== expected.teamIdentifier) {
      throw new SigningMaterialError("APPLE_PASS_CERTIFICATE does not match APPLE_TEAM_IDENTIFIER");
    }

    return { signerCertificate, wwdrCertificate, privateKey };
  })();

  cache = { fingerprint, material };
  // Do not cache failures: a fixed secret should work on the next request.
  material.catch(() => {
    if (cache?.material === material) cache = null;
  });
  return material;
}

/** Produces the DER-encoded detached PKCS#7 signature for manifest.json. */
export async function signManifest(manifest: Uint8Array, material: SigningMaterial, signingTime = new Date()): Promise<Uint8Array> {
  ensureEngine();
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(manifest)));

  const signerInfo = new pkijs.SignerInfo({
    version: 1,
    sid: new pkijs.IssuerAndSerialNumber({
      issuer: material.signerCertificate.issuer,
      serialNumber: material.signerCertificate.serialNumber,
    }),
    signedAttrs: new pkijs.SignedAndUnsignedAttributes({
      type: 0,
      attributes: [
        new pkijs.Attribute({ type: OID_CONTENT_TYPE, values: [new asn1js.ObjectIdentifier({ value: OID_DATA })] }),
        new pkijs.Attribute({ type: OID_SIGNING_TIME, values: [new asn1js.UTCTime({ valueDate: signingTime })] }),
        new pkijs.Attribute({ type: OID_MESSAGE_DIGEST, values: [new asn1js.OctetString({ valueHex: toArrayBuffer(digest) })] }),
      ],
    }),
  });

  const signedData = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({ eContentType: OID_DATA }),
    signerInfos: [signerInfo],
    certificates: [material.signerCertificate, material.wwdrCertificate],
  });

  await signedData.sign(material.privateKey, 0, "SHA-256");

  const contentInfo = new pkijs.ContentInfo({ contentType: OID_SIGNED_DATA, content: signedData.toSchema(true) });
  return new Uint8Array(contentInfo.toSchema().toBER(false));
}
