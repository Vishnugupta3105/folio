import { NextResponse } from "next/server";
import { Unauthorized } from "@/lib/auth";

/**
 * Wraps a route handler so thrown errors become clean JSON instead of a stack
 * trace. Technical detail is logged server-side; the client sees a sentence.
 */
export function handle<T extends unknown[]>(
  fn: (...args: T) => Promise<Response>,
): (...args: T) => Promise<Response> {
  return async (...args: T) => {
    try {
      return await fn(...args);
    } catch (error) {
      if (error instanceof Unauthorized) {
        return NextResponse.json({ error: "Please sign in to continue." }, { status: 401 });
      }
      console.error("[folio]", error);

      // A configured-but-unmigrated database is the single most likely setup
      // mistake, and "something went wrong" sends people looking in the wrong
      // place entirely. Name it — and name which of the two it is, because the
      // fix differs: a missing table means the schema was never run, while a
      // missing column means the database predates this build. Telling someone
      // with the second problem to "run schema.sql" is a dead end, since every
      // statement in it is `create table if not exists` and does nothing once
      // the table exists.
      const of = (key: string) =>
        typeof error === "object" && error !== null && key in error
          ? String((error as Record<string, unknown>)[key])
          : "";
      const detail = of("message");
      const code = of("code");

      // 42P01 / PGRST205: no such table. 42703 / PGRST204: no such column.
      const missingTable = code === "42P01" || code === "PGRST205" || /relation .* does not exist/i.test(detail);
      const missingColumn = code === "42703" || code === "PGRST204" || /column .* does not exist|could not find the .* column/i.test(detail);

      if (missingTable) {
        return NextResponse.json(
          {
            error:
              "Your database is connected but empty. Run supabase/schema.sql in the " +
              "Supabase SQL Editor, then try again.",
          },
          { status: 503 },
        );
      }
      if (missingColumn || /schema cache/i.test(detail)) {
        return NextResponse.json(
          {
            error:
              "Your database is out of date — it is missing a column this version needs " +
              `(${detail || "unknown column"}). Re-run supabase/schema.sql in the Supabase ` +
              "SQL Editor; it repairs an existing database as well as creating a new one.",
          },
          { status: 503 },
        );
      }

      return NextResponse.json(
        { error: "Something went wrong on our end. Your reading is safe." },
        { status: 500 },
      );
    }
  };
}

export const json = NextResponse.json;

export function badRequest(message: string): Response {
  return NextResponse.json({ error: message }, { status: 400 });
}

export function notFound(message = "Not found."): Response {
  return NextResponse.json({ error: message }, { status: 404 });
}
