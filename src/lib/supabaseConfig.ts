// Supabase project configuration.
//
// Both values are public by design (spec §6.2): the anon key grants nothing
// on its own — Row Level Security restricts every row to its authenticated
// owner, and journal content is ciphertext the server cannot read anyway.
//
// Find them in your Supabase dashboard under Project Settings → API.
// Leave both empty to run the app local-only with sync disabled.

export const SUPABASE_URL = "https://hpbdtcoskwmcggiyqtde.supabase.co";
export const SUPABASE_ANON_KEY = "sb_publishable_9gAkQiTJHoEGIpr3Sr_y-A_1tLtJqg1";
