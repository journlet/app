// Build-time substitution of the Supabase origins into index.html's CSP
// (assessment Finding 20).
//
// The project host used to be written out twice: in index.html's connect-src,
// and in src/lib/supabaseConfig.ts. Anyone forking, migrating project, or
// rotating after a free-tier pause changed the config and left the policy
// behind, and the result is silent: the CSP blocks the request before Supabase
// is reached, so there is no server error to surface and NotSyncingBanner has
// nothing to say. Naming both files in the README warned about the class of
// error. Deriving one from the other removes it.
//
// The policy itself stays in the markup, where a reviewer looks for it, and
// where vite.config.ts already says it should stay. Only the origins move.

/** The token index.html carries in place of the Supabase origins. */
export const ORIGINS_PLACEHOLDER = "%SUPABASE_ORIGINS%";

/**
 * The connect-src entries a Supabase project needs: REST and auth over HTTPS,
 * realtime over WSS, the same host for both. An empty URL means sync is
 * switched off (see supabaseConfig.ts), and then the app may reach nothing but
 * its own origin, which is the correct policy for that configuration rather
 * than a degraded one.
 */
export function supabaseOrigins(url: string): string[] {
  const trimmed = url.trim();
  if (!trimmed) return [];
  let host: string;
  let protocol: string;
  try {
    ({ host, protocol } = new URL(trimmed));
  } catch {
    throw new Error(
      `CSP: SUPABASE_URL in src/lib/supabaseConfig.ts is not a URL: ${JSON.stringify(trimmed)}`
    );
  }
  if (protocol !== "https:")
    throw new Error(
      `CSP: SUPABASE_URL must be https, not ${protocol} — an http origin in connect-src would permit the ciphertext to travel in clear.`
    );
  return [`https://${host}`, `wss://${host}`];
}

/**
 * Substitute the placeholder. Throws rather than returning the html unchanged,
 * for the same reason devCspAllowInlineStyles throws: an unsubstituted
 * placeholder is not a recognised CSP source expression, so the browser would
 * discard it, connect-src would fall back to 'self' alone, and sync would fail
 * exactly as silently as the duplicated host did. A no-op here would reproduce
 * the finding while looking like a fix.
 */
export function injectSupabaseOrigins(html: string, url: string): string {
  if (!html.includes(ORIGINS_PLACEHOLDER))
    throw new Error(
      `CSP: ${ORIGINS_PLACEHOLDER} not found in index.html. The connect-src origins are no longer being derived from src/lib/supabaseConfig.ts, so changing the project would break sync silently. Restore the placeholder rather than writing the host back into the markup.`
    );
  const origins = supabaseOrigins(url).join(" ");
  return (
    html
      .split(ORIGINS_PLACEHOLDER)
      .join(origins)
      // Sync switched off leaves "connect-src 'self' ;" behind. Legal, but a
      // policy is read by people too.
      .replace(/connect-src 'self' +;/, "connect-src 'self';")
  );
}
