// Round-trip test for the E2EE primitives.
// Run: node --experimental-strip-types tests/crypto.test.ts

import {
  decryptUpdate,
  encryptUpdate,
  exportJournalKeyCode,
  generateDataKey,
  generateKeeperKey,
  importJournalKeyCode,
  unwrapDataKey,
  wrapDataKey,
} from "../src/lib/crypto.ts";

const assert = (cond: boolean, msg: string) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

const keeper = await generateKeeperKey();
const data = await generateDataKey();

// wrap → unwrap gives back a working data key
const wrapped = await wrapDataKey(data, keeper);
const unwrapped = await unwrapDataKey(wrapped, keeper);

const update = crypto.getRandomValues(new Uint8Array(1024));
const payload = await encryptUpdate(data, update);
assert(payload[0] === 1, "payload carries version byte");
assert(payload.length > update.length, "payload is iv + ciphertext + tag");

const back = await decryptUpdate(unwrapped, payload);
assert(
  back.length === update.length && back.every((b, i) => b === update[i]),
  "encrypt → decrypt round trip via wrapped/unwrapped key"
);

// ciphertext really is opaque: flipping one byte must fail authentication
const tampered = payload.slice();
tampered[20] ^= 0xff;
let failed = false;
try {
  await decryptUpdate(data, tampered);
} catch {
  failed = true;
}
assert(failed, "tampered payload is rejected (GCM auth)");

// journal key code round trip
const code = await exportJournalKeyCode(keeper);
assert(/^J1(-[0-9A-Z]{1,4})+$/.test(code), `code format looks right (${code})`);
const reimported = await importJournalKeyCode(code);
const unwrapped2 = await unwrapDataKey(wrapped, reimported);
const back2 = await decryptUpdate(unwrapped2, payload);
assert(
  back2.every((b, i) => b === update[i]),
  "journal key code round trip unlocks the same data key"
);

// lowercase + ambiguous characters are forgiven
const sloppy = code.toLowerCase().replace(/-/g, " ");
await importJournalKeyCode(sloppy);
console.log("ok: sloppy code entry (lowercase, spaces) accepted");

// wrong key must not unwrap
const stranger = await generateKeeperKey();
let rejected = false;
try {
  await unwrapDataKey(wrapped, stranger);
} catch {
  rejected = true;
}
assert(rejected, "wrong journal key cannot unwrap the data key");

console.log("\nAll crypto tests passed.");
