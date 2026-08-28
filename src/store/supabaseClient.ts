// The Supabase client, on its own, so that needing it does not mean starting the
// sync engine.
//
// It used to be declared in store/sync.ts, which is the right place for the thing
// that uses it most and the wrong place for the thing that owns it. Importing a
// name from a module evaluates the whole module, and evaluating store/sync.ts
// constructs this client *and* registers the live-edit listener on the journal
// document, which is what pushes local writes to the server. So
// store/usage.ts, thirty lines that read one row to say how full an account is,
// pulled in eighteen hundred lines of sync engine and a global side effect to get
// at a client it only ever calls `.from()` on.
//
// Nothing was broken by that in the running app, because App.tsx imports the sync
// engine anyway, and this file does not change what happens there. What it changes
// is what the coupling costs everywhere else. tests/usage.test.ts had to stub the
// entire engine to exercise a storage readout, which is a large lie told to ask a
// small question, and any future caller wanting a client would have paid the same
// price. store/sync.ts still re-exports `supabase`, so nothing that reads it from
// there has to move.
//
// This module is deliberately inert: it constructs a client and does nothing else.
// Anything with a side effect belongs in the engine, not here.

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { SUPABASE_ANON_KEY, SUPABASE_URL } from "../lib/supabaseConfig";
import { isConfigured } from "./syncStatus";

/** Null when sync is not configured in this build (see lib/supabaseConfig). */
export const supabase: SupabaseClient | null = isConfigured()
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;
