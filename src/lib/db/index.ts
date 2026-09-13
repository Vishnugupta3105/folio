import "server-only";
import type { DataAdapter } from "./adapter";
import { localAdapter } from "./local";
import { supabaseAdapter } from "./supabase";

/**
 * Supabase when configured, the file-backed adapter otherwise.
 *
 * This lets the app run end-to-end before any keys exist; dropping the three
 * Supabase variables into .env.local switches storage with no code change.
 */
export const supabaseConfigured = (): boolean =>
  Boolean(
    (process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL) &&
      process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

function resolve(): DataAdapter {
  if (supabaseConfigured()) return supabaseAdapter;

  if (process.env.NODE_ENV === "production") {
    // The local adapter writes to the filesystem, which is ephemeral or
    // read-only on every serverless host. Failing loudly on the first request is
    // far better than a deployment that appears to work and quietly loses every
    // reader's library.
    throw new Error(
      "Folio needs Supabase in production. Set SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY, then run supabase/schema.sql in the SQL editor.",
    );
  }
  return localAdapter;
}

/**
 * Resolved on first use rather than at import.
 *
 * `next build` imports every route module to collect its configuration, with
 * NODE_ENV already set to production — deciding the adapter eagerly would turn a
 * missing key into a build failure instead of a clear runtime error.
 */
export const db: DataAdapter = new Proxy({} as DataAdapter, {
  get(_target, property) {
    const adapter = resolve();
    const value = adapter[property as keyof DataAdapter];
    return typeof value === "function" ? value.bind(adapter) : value;
  },
});

export type { DataAdapter };
