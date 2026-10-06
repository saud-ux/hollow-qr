/**
 * Imports the Pass Type ID private key into WebCrypto.
 *
 * Supported inputs (PEM or DER, base64-encoded in the secret):
 *   - PKCS#8  "BEGIN PRIVATE KEY"            (recommended)
 *   - PKCS#1  "BEGIN RSA PRIVATE KEY"        (wrapped into PKCS#8 here)
 *   - PKCS#8  "BEGIN ENCRYPTED PRIVATE KEY"  (PBES2 / PBKDF2 / AES-CBC, decrypted
 *             natively with WebCrypto using APPLE_PASS_PRIVATE_KEY_PASSPHRASE)
 * Legacy OpenSSL "Proc-Type: 4,ENCRYPTED" keys are rejected with guidance.
 */
import * as asn1js from "asn1js";
import { SigningMaterialError, asPem } from "./pem";

const OID_RSA = "1.2.840.113549.1.1.1";
const OID_PBES2 = "1.2.840.113549.1.5.13";
const OID_PBKDF2 = "1.2.840.113549.1.5.12";
const PRF_HASH: Record<string, string> = {
  "1.2.840.113549.2.7": "SHA-1",
  "1.2.840.113549.2.9": "SHA-256",
  "1.2.840.113549.2.10": "SHA-384",
  "1.2.840.113549.2.11": "SHA-512",
};
const AES_CBC_KEY_BYTES: Record<string, number> = {
  "2.16.840.1.101.3.4.1.2": 16, // aes-128-cbc
  "2.16.840.1.101.3.4.1.42": 32, // aes-256-cbc
};

const RSA_IMPORT = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

function wrapPkcs1(pkcs1: Uint8Array): Uint8Array<ArrayBuffer> {
  const seq = new asn1js.Sequence({
    value: [
      new asn1js.Integer({ value: 0 }),
      new asn1js.Sequence({ value: [new asn1js.ObjectIdentifier({ value: OID_RSA }), new asn1js.Null()] }),
      new asn1js.OctetString({ valueHex: toArrayBuffer(pkcs1) }),
    ],
  });
  return new Uint8Array(seq.toBER(false));
}

async function importPkcs8(der: Uint8Array<ArrayBuffer>): Promise<CryptoKey> {
  return crypto.subtle.importKey("pkcs8", der, RSA_IMPORT, false, ["sign"]);
}

function oidOf(node: asn1js.AsnType | undefined): string {
  if (!(node instanceof asn1js.ObjectIdentifier)) throw new SigningMaterialError("unexpected private key structure");
  return node.valueBlock.toString();
}

function seqItems(node: asn1js.AsnType | undefined): asn1js.AsnType[] {
  if (!(node instanceof asn1js.Sequence)) throw new SigningMaterialError("unexpected private key structure");
  return node.valueBlock.value;
}

async function decryptPbes2(der: Uint8Array, passphrase: string): Promise<Uint8Array<ArrayBuffer>> {
  const parsed = asn1js.fromBER(toArrayBuffer(der));
  if (parsed.offset === -1) throw new SigningMaterialError("encrypted private key is not valid DER");
  const [algId, encrypted] = seqItems(parsed.result);
  const [schemeOid, schemeParams] = seqItems(algId);
  if (oidOf(schemeOid) !== OID_PBES2) {
    throw new SigningMaterialError("only PBES2-encrypted private keys are supported (re-export with `openssl pkcs8 -topk8 -v2 aes-256-cbc` or remove the passphrase)");
  }
  const [kdf, enc] = seqItems(schemeParams);
  const [kdfOid, kdfParams] = seqItems(kdf);
  if (oidOf(kdfOid) !== OID_PBKDF2) throw new SigningMaterialError("unsupported key derivation function");
  const kdfItems = seqItems(kdfParams);
  const salt = kdfItems[0];
  const iterations = kdfItems[1];
  if (!(salt instanceof asn1js.OctetString) || !(iterations instanceof asn1js.Integer)) {
    throw new SigningMaterialError("unexpected PBKDF2 parameters");
  }
  let prfHash = "SHA-1";
  for (const item of kdfItems.slice(2)) {
    if (item instanceof asn1js.Sequence) {
      const hash = PRF_HASH[oidOf(item.valueBlock.value[0])];
      if (!hash) throw new SigningMaterialError("unsupported PBKDF2 PRF");
      prfHash = hash;
    }
  }
  const [encOid, ivNode] = seqItems(enc);
  const keyBytes = AES_CBC_KEY_BYTES[oidOf(encOid)];
  if (!keyBytes || !(ivNode instanceof asn1js.OctetString)) {
    throw new SigningMaterialError("unsupported private key cipher (use aes-128-cbc or aes-256-cbc)");
  }
  if (!(encrypted instanceof asn1js.OctetString)) throw new SigningMaterialError("unexpected private key structure");

  const baseKey = await crypto.subtle.importKey("raw", new TextEncoder().encode(passphrase), "PBKDF2", false, ["deriveKey"]);
  const aesKey = await crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt.valueBlock.valueHexView), iterations: iterations.valueBlock.valueDec, hash: prfHash },
    baseKey,
    { name: "AES-CBC", length: keyBytes * 8 },
    false,
    ["decrypt"],
  );
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-CBC", iv: new Uint8Array(ivNode.valueBlock.valueHexView) },
      aesKey,
      new Uint8Array(encrypted.valueBlock.valueHexView),
    );
    return new Uint8Array(plain);
  } catch {
    throw new SigningMaterialError("could not decrypt the private key (wrong APPLE_PASS_PRIVATE_KEY_PASSPHRASE?)");
  }
}

export async function importPassPrivateKey(bytes: Uint8Array<ArrayBuffer>, passphrase?: string): Promise<CryptoKey> {
  const pem = asPem(bytes);
  try {
    if (!pem) {
      try {
        return await importPkcs8(bytes);
      } catch {
        return await importPkcs8(wrapPkcs1(bytes));
      }
    }
    const block = pem.find((b) => b.label.endsWith("PRIVATE KEY"));
    if (!block) throw new SigningMaterialError("APPLE_PASS_PRIVATE_KEY does not contain a private key block");
    if (/Proc-Type:\s*4,ENCRYPTED/i.test(block.headers)) {
      throw new SigningMaterialError(
        "legacy encrypted PEM keys are not supported; convert with `openssl pkcs8 -topk8 -nocrypt` (or -v2 aes-256-cbc)",
      );
    }
    switch (block.label) {
      case "PRIVATE KEY":
        return await importPkcs8(block.der);
      case "RSA PRIVATE KEY":
        return await importPkcs8(wrapPkcs1(block.der));
      case "ENCRYPTED PRIVATE KEY":
        if (!passphrase) throw new SigningMaterialError("APPLE_PASS_PRIVATE_KEY_PASSPHRASE is required for an encrypted key");
        {
          const decrypted = await decryptPbes2(block.der, passphrase);
          try {
            return await importPkcs8(decrypted);
          } catch {
            // A wrong passphrase occasionally yields valid padding but garbage bytes.
            throw new SigningMaterialError("could not decrypt the private key (wrong APPLE_PASS_PRIVATE_KEY_PASSPHRASE?)");
          }
        }
      default:
        throw new SigningMaterialError(`unsupported private key type: ${block.label}`);
    }
  } catch (err) {
    if (err instanceof SigningMaterialError) throw err;
    throw new SigningMaterialError("APPLE_PASS_PRIVATE_KEY could not be imported (expected an RSA key)");
  }
}
