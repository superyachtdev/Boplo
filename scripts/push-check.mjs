// node scripts/push-check.mjs : decrypts a payload made by functions/lib/push.js the way a browser would (RFC 8291)
import { encryptPayload } from '../functions/lib/push.js';
const enc = new TextEncoder(), b64u = b => Buffer.from(b).toString('base64url');
const ua = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await crypto.subtle.exportKey('raw', ua.publicKey)), auth = crypto.getRandomValues(new Uint8Array(16));
const body = await encryptPayload(b64u(uaPub), b64u(auth), JSON.stringify({ title: 'Hello', body: 'Lesson tomorrow' }));
const salt = body.slice(0, 16), rs = new DataView(body.buffer).getUint32(16), idlen = body[20], asPub = body.slice(21, 21 + idlen), ct = body.slice(21 + idlen);
const asKey = await crypto.subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
const shared = new Uint8Array(await crypto.subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
const hk = async (s, ikm, info, bits) => new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: s, info }, await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']), bits));
const cat = (...a) => Uint8Array.from(a.flatMap(x => [...x]));
const ikm = await hk(auth, shared, cat(enc.encode('WebPush: info\0'), uaPub, asPub), 256);
const cek = await hk(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 128), nonce = await hk(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 96);
const pt = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, await crypto.subtle.importKey('raw', cek, 'AES-GCM', false, ['decrypt']), ct));
console.log('rs', rs, 'idlen', idlen, 'delimiter', pt[pt.length - 1], 'payload', new TextDecoder().decode(pt.slice(0, -1)));
