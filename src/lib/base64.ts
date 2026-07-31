// Base64 for the byte strings that go into Supabase columns.
//
// Pulled out of store/sync.ts when device keys needed the same pair. Not
// btoa(String.fromCharCode(...bytes)): spreading a large array into a call
// blows the argument limit, and a CRDT update is easily large enough.

export const b64encode = (bytes: Uint8Array): string => {
  let s = "";
  bytes.forEach((b) => (s += String.fromCharCode(b)));
  return btoa(s);
};

export const b64decode = (s: string): Uint8Array =>
  Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
