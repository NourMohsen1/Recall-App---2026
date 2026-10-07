import { execSync } from 'node:child_process';
import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { verifyAssertion, verifyAttestation } from '../src/appAttest.ts';

const sh = (c: string) => execSync(c, { cwd: process.cwd(), stdio: ['ignore', 'pipe', 'ignore'] });
const sha = (b: Buffer) => createHash('sha256').update(b).digest();
const APP_ID = 'JF22LNW5JZ.com.nourwalid.recall';
const pemB64 = (f: string) => readFileSync(f, 'utf8').replace(/-----[^-]+-----/g, '').replace(/\s+/g, '');

// The phone's key, as App Attest makes it
const leafPriv = createPrivateKey(readFileSync('leaf.p8'));
const jwk = createPublicKey(leafPriv).export({ format: 'jwk' }) as { x: string; y: string };
const pubPoint = Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, 'base64url'), Buffer.from(jwk.y, 'base64url')]);
const keyId = sha(pubPoint);

// authenticator data: rpIdHash | flags | counter | aaguid | credIdLen | credId | (COSE key, unused)
const u32 = (n: number) => { const b = Buffer.alloc(4); b.writeUInt32BE(n); return b; };
const u16 = (n: number) => { const b = Buffer.alloc(2); b.writeUInt16BE(n); return b; };
const authData = (appId: string, counter: number, aaguid = 'appattestdevelop') =>
  Buffer.concat([sha(Buffer.from(appId)), Buffer.from([0x40]), u32(counter), Buffer.from(aaguid), u16(32), keyId, Buffer.from([0xa0])]);

// the leaf certificate carries nonce = SHA256(authData || SHA256(challenge))
function leafCert(nonce: Buffer, signer = 'int') {
  writeFileSync('leaf.ext', `1.2.840.113635.100.8.2=DER:30:24:a1:22:04:20:${[...nonce].map((b) => b.toString(16).padStart(2, '0')).join(':')}\n`);
  sh(`openssl req -new -key leaf.key -subj "/CN=Test Leaf" -out leaf.csr`);
  sh(`openssl x509 -req -in leaf.csr -CA ${signer}.pem -CAkey ${signer}.key -CAcreateserial -sha384 -days 3 -extfile leaf.ext -outform der -out leaf.der`);
  return readFileSync('leaf.der');
}

// minimal CBOR encoder
function cb(v: unknown): Buffer {
  const head = (major: number, n: number) => n < 24 ? Buffer.from([(major << 5) | n]) : n < 256 ? Buffer.from([(major << 5) | 24, n]) : Buffer.concat([Buffer.from([(major << 5) | 25]), u16(n)]);
  if (Buffer.isBuffer(v)) return Buffer.concat([head(2, v.length), v]);
  if (typeof v === 'string') return Buffer.concat([head(3, Buffer.byteLength(v)), Buffer.from(v)]);
  if (Array.isArray(v)) return Buffer.concat([head(4, v.length), ...v.map(cb)]);
  const e = Object.entries(v as object);
  return Buffer.concat([head(5, e.length), ...e.flatMap(([k, x]) => [cb(k), cb(x)])]);
}
const intDer = Buffer.from(pemB64('int.pem'), 'base64');
const ROOT = pemB64('root.pem');

async function attest(o: { challenge?: string; signedChallenge?: string; appId?: string; counter?: number; keyIdB64?: string; signer?: string; aaguid?: string } = {}) {
  const challenge = o.challenge ?? 'challenge-123';
  const ad = authData(o.appId ?? APP_ID, o.counter ?? 0, o.aaguid);
  const nonce = sha(Buffer.concat([ad, sha(Buffer.from(o.signedChallenge ?? challenge))]));
  const att = cb({ fmt: 'apple-appattest', attStmt: { x5c: [leafCert(nonce, o.signer), intDer], receipt: Buffer.alloc(0) }, authData: ad });
  return verifyAttestation(att.toString('base64'), o.keyIdB64 ?? keyId.toString('base64'), challenge, APP_ID, Date.now(), ROOT);
}

function assertion(challenge: string, counter: number, appId = APP_ID) {
  const ad = Buffer.concat([sha(Buffer.from(appId)), Buffer.from([0x40]), u32(counter)]);
  const nonce = sha(Buffer.concat([ad, sha(Buffer.from(challenge))]));
  const signature = sign('sha256', nonce, leafPriv); // DER, as the Secure Enclave returns it
  return cb({ signature, authenticatorData: ad }).toString('base64');
}

const line = (name: string, r: unknown, want: 'pass' | 'fail') => {
  const passed = typeof r !== 'string';
  console.log(`${passed === (want === 'pass') ? 'OK  ' : 'BAD '} ${name.padEnd(46)} → ${passed ? (typeof r === 'number' ? 'accepted, counter ' + r : 'accepted') : 'refused: ' + r}`);
};

const good = await attest();
line('genuine attestation', good, 'pass');
line('production environment', await attest({ aaguid: 'appattest\0\0\0\0\0\0\0' }), 'pass');
line('forged: different challenge (replay)', await attest({ signedChallenge: 'old-challenge' }), 'fail');
line('forged: another app\'s App ID', await attest({ appId: 'XXXXXXXXXX.com.someone.else' }), 'fail');
line('forged: key used before (counter 5)', await attest({ counter: 5 }), 'fail');
line('forged: claims a different key', await attest({ keyIdB64: sha(Buffer.from('other')).toString('base64') }), 'fail');
line('forged: leaf signed by the root, skipping Apple\'s intermediate', await attest({ signer: 'root' }), 'fail');
line('forged: unknown environment', await attest({ aaguid: 'notappleattest!!' }), 'fail');

const pk = (good as { publicKey: Uint8Array }).publicKey;
line('assertion, genuine', await verifyAssertion(assertion('renew-1', 1), 'renew-1', pk, 0, APP_ID), 'pass');
line('assertion, replayed counter', await verifyAssertion(assertion('renew-2', 1), 'renew-2', pk, 1, APP_ID), 'fail');
line('assertion, wrong challenge', await verifyAssertion(assertion('renew-3', 2), 'something-else', pk, 1, APP_ID), 'fail');
line('assertion, another app', await verifyAssertion(assertion('renew-4', 2, 'X.y.z'), 'renew-4', pk, 1, APP_ID), 'fail');
