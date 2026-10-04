/**
 * Generates a throwaway CA ("fake WWDR") and a Pass Type ID-style signer
 * certificate for tests. Never use these outside tests.
 */
import { generateKeyPairSync } from "node:crypto";
import forge from "node-forge";

export interface TestCerts {
  wwdrPem: string;
  signerCertPem: string;
  signerKeyPkcs8Pem: string;
  signerKeyPkcs1Pem: string;
  signerKeyEncryptedPem: string;
  passphrase: string;
}

let cached: TestCerts | null = null;

function makeCert(opts: {
  subject: forge.pki.CertificateField[];
  issuer: forge.pki.CertificateField[];
  publicKey: forge.pki.PublicKey;
  signingKey: forge.pki.PrivateKey;
  serial: string;
  ca: boolean;
}) {
  const cert = forge.pki.createCertificate();
  cert.publicKey = opts.publicKey;
  cert.serialNumber = opts.serial;
  cert.validity.notBefore = new Date(Date.now() - 24 * 3600 * 1000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 24 * 3600 * 1000);
  cert.setSubject(opts.subject);
  cert.setIssuer(opts.issuer);
  cert.setExtensions([{ name: "basicConstraints", cA: opts.ca }]);
  cert.sign(opts.signingKey as forge.pki.rsa.PrivateKey, forge.md.sha256.create());
  return cert;
}

export function testCerts(passTypeIdentifier = "pass.test.hollow", teamIdentifier = "TEAM123456"): TestCerts {
  if (cached) return cached;
  const passphrase = "test-passphrase-123";
  const ca = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const signer = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const caKey = forge.pki.privateKeyFromPem(ca.privateKey.export({ type: "pkcs8", format: "pem" }).toString());
  const caPub = forge.pki.publicKeyFromPem(ca.publicKey.export({ type: "spki", format: "pem" }).toString());
  const signerPub = forge.pki.publicKeyFromPem(signer.publicKey.export({ type: "spki", format: "pem" }).toString());
  const caName = [{ name: "commonName", value: "Fake Apple WWDR (tests only)" }];
  const wwdr = makeCert({ subject: caName, issuer: caName, publicKey: caPub, signingKey: caKey, serial: "01", ca: true });
  const signerCert = makeCert({
    subject: [
      { type: "0.9.2342.19200300.100.1.1", value: passTypeIdentifier },
      { name: "commonName", value: `Pass Type ID: ${passTypeIdentifier}` },
      { name: "organizationalUnitName", value: teamIdentifier },
    ],
    issuer: caName,
    publicKey: signerPub,
    signingKey: caKey,
    serial: "02",
    ca: false,
  });
  cached = {
    wwdrPem: forge.pki.certificateToPem(wwdr),
    signerCertPem: forge.pki.certificateToPem(signerCert),
    signerKeyPkcs8Pem: signer.privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    signerKeyPkcs1Pem: signer.privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    signerKeyEncryptedPem: signer.privateKey
      .export({ type: "pkcs8", format: "pem", cipher: "aes-256-cbc", passphrase })
      .toString(),
    passphrase,
  };
  return cached;
}

export const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
