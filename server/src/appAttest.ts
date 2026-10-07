// Apple App Attest, checked by hand: the steps Apple lists in "Validating
// apps that connect to your server", with no third-party library, so every
// check is in view. It proves a request comes from the genuine Recall,
// signed by Nour's team, running on a real iPhone — the one thing a token
// baked into the app can never prove.
//
//   verifyAttestation — once per install: Apple vouches for a key that
//     lives in the phone's Secure Enclave and can never be read out.
//   verifyAssertion — afterwards: that same key signs a fresh challenge,
//     so a pass copied off a phone can't be renewed anywhere else.

/** Apple App Attestation Root CA (apple.com/certificateauthority), valid to
 *  2045. SHA-256 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32 */
const APPLE_ROOT_B64 = 'MIICITCCAaegAwIBAgIQC/O+DvHN0uD7jG5yH2IXmDAKBggqhkjOPQQDAzBSMSYwJAYDVQQDDB1BcHBsZSBBcHAgQXR0ZXN0YXRpb24gUm9vdCBDQTETMBEGA1UECgwKQXBwbGUgSW5jLjETMBEGA1UECAwKQ2FsaWZvcm5pYTAeFw0yMDAzMTgxODMyNTNaFw00NTAzMTUwMDAwMDBaMFIxJjAkBgNVBAMMHUFwcGxlIEFwcCBBdHRlc3RhdGlvbiBSb290IENBMRMwEQYDVQQKDApBcHBsZSBJbmMuMRMwEQYDVQQIDApDYWxpZm9ybmlhMHYwEAYHKoZIzj0CAQYFK4EEACIDYgAERTHhmLW07ATaFQIEVwTtT4dyctdhNbJhFs/Ii2FdCgAHGbpphY3+d8qjuDngIN3WVhQUBHAoMeQ/cLiP1sOUtgjqK9auYen1mMEvRq9Sk3Jm5X8U62H+xTD3FE9TgS41o0IwQDAPBgNVHRMBAf8EBTADAQH/MB0GA1UdDgQWBBSskRBTM72+aEH/pwyp5frq5eWKoTAOBgNVHQ8BAf8EBAMCAQYwCgYIKoZIzj0EAwMDaAAwZQIwQgFGnByvsiVbpTKwSga0kP0e8EeDS4+sQmTvb7vn53O5+FRXgeLhpJ06ysC5PrOyAjEAp5U4xDgEgllF7En3VcE3iexZZtKeYnpqtijVoyFraWVIyd/dganmrduC1bmTBGwD';

const NONCE_OID = '1.2.840.113635.100.8.2';
/** "appattest" + 7 zero bytes in production; "appattestdevelop" for builds
 *  signed for development. Both are signed by Apple for our App ID only. */
const AAGUIDS = ['appattestdevelop', 'appattest\0\0\0\0\0\0\0'];

const enc = new TextEncoder();
const sha256 = async (data: Uint8Array): Promise<Uint8Array> => new Uint8Array(await crypto.subtle.digest('SHA-256', data));
const b64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};
const equal = (a: Uint8Array, b: Uint8Array): boolean => a.length === b.length && a.every((x, i) => x === b[i]);

// ── DER (just enough of X.509) ────────────────────────────────────────────

type Der = { tag: number; start: number; header: number; length: number; bytes: Uint8Array };

function derAt(buf: Uint8Array, at: number): Der {
  const tag = buf[at];
  let len = buf[at + 1];
  let header = 2;
  if (len & 0x80) {
    const n = len & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = len * 256 + buf[at + 2 + i];
    header += n;
  }
  if (at + header + len > buf.length) throw new Error('DER runs past its buffer');
  return { tag, start: at, header, length: len, bytes: buf.subarray(at, at + header + len) };
}

/** The children of a constructed DER element. */
function children(el: Der): Der[] {
  const out: Der[] = [];
  const body = el.bytes.subarray(el.header);
  for (let at = 0; at < body.length; ) {
    const child = derAt(body, at);
    out.push(child);
    at += child.header + child.length;
  }
  return out;
}

const content = (el: Der): Uint8Array => el.bytes.subarray(el.header);

function oid(el: Der): string {
  const b = content(el);
  const parts = [Math.floor(b[0] / 40), b[0] % 40];
  let v = 0;
  for (let i = 1; i < b.length; i++) {
    v = v * 128 + (b[i] & 0x7f);
    if (!(b[i] & 0x80)) {
      parts.push(v);
      v = 0;
    }
  }
  return parts.join('.');
}

function derTime(el: Der): number {
  const s = new TextDecoder().decode(content(el));
  // UTCTime YYMMDDHHMMSSZ or GeneralizedTime YYYYMMDDHHMMSSZ
  const full = el.tag === 0x17 ? (Number(s.slice(0, 2)) < 50 ? '20' : '19') + s : s;
  return Date.UTC(+full.slice(0, 4), +full.slice(4, 6) - 1, +full.slice(6, 8), +full.slice(8, 10), +full.slice(10, 12), +full.slice(12, 14));
}

type Cert = {
  tbs: Uint8Array;
  sigAlg: string;
  signature: Uint8Array;
  spki: Uint8Array;
  curve: 'P-256' | 'P-384';
  publicKey: Uint8Array; // the raw EC point
  notBefore: number;
  notAfter: number;
  extensions: Map<string, Uint8Array>;
};

function parseCert(der: Uint8Array): Cert {
  const [tbsEl, algEl, sigEl] = children(derAt(der, 0));
  const tbs = children(tbsEl);
  // version [0] is present in every v3 certificate
  const i = tbs[0].tag === 0xa0 ? 1 : 0;
  const validity = children(tbs[i + 3]);
  const spkiEl = tbs[i + 5];
  const [spkiAlg, spkiKey] = children(spkiEl);
  const curveOid = oid(children(spkiAlg)[1]);
  const curve = curveOid === '1.2.840.10045.3.1.7' ? 'P-256' : curveOid === '1.3.132.0.34' ? 'P-384' : null;
  if (!curve) throw new Error('unsupported key curve ' + curveOid);
  const extensions = new Map<string, Uint8Array>();
  const extWrap = tbs.find((t) => t.tag === 0xa3);
  if (extWrap) {
    for (const ext of children(children(extWrap)[0])) {
      const parts = children(ext);
      extensions.set(oid(parts[0]), content(parts[parts.length - 1]));
    }
  }
  return {
    tbs: tbsEl.bytes,
    sigAlg: oid(children(algEl)[0]),
    signature: content(sigEl).subarray(1), // BIT STRING: skip the unused-bits byte
    spki: spkiEl.bytes,
    curve,
    publicKey: content(spkiKey).subarray(1),
    notBefore: derTime(validity[0]),
    notAfter: derTime(validity[1]),
    extensions,
  };
}

/** ECDSA signatures come as DER SEQUENCE { r, s }; WebCrypto wants r||s. */
function rawSignature(der: Uint8Array, size: number): Uint8Array {
  const [r, s] = children(derAt(der, 0)).map((x) => {
    let v = content(x);
    while (v.length > size && v[0] === 0) v = v.subarray(1);
    const out = new Uint8Array(size);
    out.set(v, size - v.length);
    return out;
  });
  return concat(r, s);
}

async function verifySignedBy(cert: Cert, issuer: Cert): Promise<boolean> {
  const hash = cert.sigAlg === '1.2.840.10045.4.3.3' ? 'SHA-384' : cert.sigAlg === '1.2.840.10045.4.3.2' ? 'SHA-256' : null;
  if (!hash) return false;
  const key = await crypto.subtle.importKey('spki', issuer.spki, { name: 'ECDSA', namedCurve: issuer.curve }, false, ['verify']);
  const size = issuer.curve === 'P-384' ? 48 : 32;
  return crypto.subtle.verify({ name: 'ECDSA', hash }, key, rawSignature(cert.signature, size), cert.tbs);
}

// ── CBOR (just enough for Apple's two objects) ────────────────────────────

function cbor(buf: Uint8Array): unknown {
  let at = 0;
  const length = (info: number): number => {
    if (info < 24) return info;
    const n = info === 24 ? 1 : info === 25 ? 2 : info === 26 ? 4 : info === 27 ? 8 : -1;
    if (n < 0) throw new Error('unsupported CBOR length');
    let v = 0;
    for (let i = 0; i < n; i++) v = v * 256 + buf[at++];
    return v;
  };
  const item = (): unknown => {
    const head = buf[at++];
    const major = head >> 5;
    const len = length(head & 31);
    switch (major) {
      case 0:
        return len;
      case 2: {
        const v = buf.subarray(at, at + len);
        at += len;
        return v;
      }
      case 3: {
        const v = new TextDecoder().decode(buf.subarray(at, at + len));
        at += len;
        return v;
      }
      case 4:
        return Array.from({ length: len }, item);
      case 5: {
        const m: Record<string, unknown> = {};
        for (let i = 0; i < len; i++) m[String(item())] = item();
        return m;
      }
      default:
        throw new Error('unsupported CBOR type ' + major);
    }
  };
  return item();
}

// ── The two checks ────────────────────────────────────────────────────────

/** An attestation passed: the install's public key (raw EC point), for
 *  checking its later assertions. */
export type Attested = { publicKey: Uint8Array };

/** Apple's steps 1–9. Returns the reason on failure. */
export async function verifyAttestation(
  attestationB64: string,
  keyIdB64: string,
  challenge: string,
  appId: string,
  now = Date.now(),
  /** Only tests pass another root. */
  rootB64 = APPLE_ROOT_B64,
): Promise<Attested | string> {
  const obj = cbor(b64(attestationB64)) as { fmt?: string; attStmt?: { x5c?: Uint8Array[] }; authData?: Uint8Array };
  if (obj.fmt !== 'apple-appattest' || !obj.attStmt?.x5c || obj.attStmt.x5c.length < 2 || !obj.authData) {
    return 'not an App Attest object';
  }
  const [leaf, intermediate] = obj.attStmt.x5c.map(parseCert);
  const root = parseCert(b64(rootB64));

  // 1. The chain: leaf ← intermediate ← Apple's root, all in date.
  for (const c of [leaf, intermediate]) if (now < c.notBefore || now > c.notAfter) return 'certificate out of date';
  if (!(await verifySignedBy(intermediate, root))) return 'intermediate not signed by Apple';
  if (!(await verifySignedBy(leaf, intermediate))) return 'leaf not signed by the intermediate';

  // 2–4. The nonce Apple put in the certificate matches this attestation
  // and this server's challenge.
  const authData = obj.authData;
  const clientDataHash = await sha256(enc.encode(challenge));
  const nonce = await sha256(concat(authData, clientDataHash));
  const ext = leaf.extensions.get(NONCE_OID);
  if (!ext) return 'no nonce in the certificate';
  const seq = derAt(ext, 0);
  const tagged = children(seq).find((c) => c.tag === 0xa1);
  const certNonce = tagged ? content(children(tagged)[0]) : null;
  if (!certNonce || !equal(certNonce, nonce)) return 'nonce mismatch';

  // 5. The key is the one the app named.
  const keyId = b64(keyIdB64);
  if (!equal(await sha256(leaf.publicKey), keyId)) return 'key id does not match the certificate';

  // 6–9. Issued for Recall's App ID, a fresh key, from App Attest.
  if (!equal(authData.subarray(0, 32), await sha256(enc.encode(appId)))) return 'not issued for Recall';
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  if (counter !== 0) return 'counter not zero';
  const aaguid = new TextDecoder().decode(authData.subarray(37, 53));
  if (!AAGUIDS.includes(aaguid)) return 'unknown App Attest environment';
  const credLen = new DataView(authData.buffer, authData.byteOffset + 53, 2).getUint16(0);
  if (!equal(authData.subarray(55, 55 + credLen), keyId)) return 'credential id does not match the key';

  return { publicKey: leaf.publicKey };
}

/** An assertion: the install's key signed this challenge, for Recall, with
 *  a counter that moved on. Returns the new counter, or the reason. */
export async function verifyAssertion(
  assertionB64: string,
  challenge: string,
  publicKey: Uint8Array,
  lastCounter: number,
  appId: string,
): Promise<number | string> {
  const obj = cbor(b64(assertionB64)) as { signature?: Uint8Array; authenticatorData?: Uint8Array };
  if (!obj.signature || !obj.authenticatorData) return 'not an App Attest assertion';
  const authData = obj.authenticatorData;
  const nonce = await sha256(concat(authData, await sha256(enc.encode(challenge))));
  const key = await crypto.subtle.importKey('raw', publicKey, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, rawSignature(obj.signature, 32), nonce);
  if (!ok) return 'signature does not verify';
  if (!equal(authData.subarray(0, 32), await sha256(enc.encode(appId)))) return 'not for Recall';
  const counter = new DataView(authData.buffer, authData.byteOffset + 33, 4).getUint32(0);
  if (counter <= lastCounter) return 'counter did not move on';
  return counter;
}
