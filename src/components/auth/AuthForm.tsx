"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { motion } from "motion/react";
import { api } from "@/lib/api";
import { Button } from "@/components/ui/Button";

export function AuthForm({ mode }: { mode: "login" | "signup" }) {
  const router = useRouter();
  const isSignup = mode === "signup";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError(null);

    const form = new FormData(event.currentTarget);
    try {
      await api(`/api/auth/${mode}`, {
        method: "POST",
        body: JSON.stringify(Object.fromEntries(form)),
      });
      router.replace("/library");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
      setPending(false);
    }
  }

  return (
    <main className="paper-grain flex min-h-dvh flex-col bg-parchment">
      <header className="px-6 py-7 sm:px-10">
        <Link href="/" className="font-display text-[1.35rem] font-semibold tracking-[0.03em] text-ink">
          Folio
        </Link>
      </header>

      <div className="flex flex-1 items-center justify-center px-6 pb-24">
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 0.68, 0.16, 1] }}
          className="w-full max-w-[24rem]"
        >
          <h1 className="font-display text-[2.3rem] font-light leading-tight tracking-[-0.01em] text-ink">
            {isSignup ? "Begin your library" : "Welcome back"}
          </h1>
          <p className="mt-2.5 text-[0.875rem] leading-relaxed text-muted">
            {isSignup
              ? "Bring a book. We'll take care of the rest."
              : "Your books are exactly where you left them."}
          </p>

          <form onSubmit={submit} className="mt-9 space-y-4">
            {isSignup && <Field name="name" label="Name" type="text" autoComplete="name" required />}
            <Field name="email" label="Email" type="email" autoComplete="email" required />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete={isSignup ? "new-password" : "current-password"}
              required
              minLength={isSignup ? 8 : undefined}
              hint={isSignup ? "At least 8 characters" : undefined}
            />

            {error && (
              <motion.p
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: "auto" }}
                role="alert"
                className="pt-1 text-[0.8rem] leading-relaxed text-oxblood"
              >
                {error}
              </motion.p>
            )}

            <Button type="submit" variant="primary" size="lg" disabled={pending} className="!mt-7 w-full">
              {pending ? "One moment…" : isSignup ? "Create account" : "Sign in"}
            </Button>
          </form>

          <p className="mt-8 text-center text-[0.82rem] text-muted">
            {isSignup ? "Already have an account? " : "New here? "}
            <Link
              href={isSignup ? "/login" : "/signup"}
              className="text-ink underline decoration-rule underline-offset-[4px] transition-colors hover:decoration-faint"
            >
              {isSignup ? "Sign in" : "Create one"}
            </Link>
          </p>
        </motion.div>
      </div>
    </main>
  );
}

function Field({
  name, label, hint, ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { name: string; label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="label block pb-2">{label}</span>
      <input
        name={name}
        className="h-11 w-full rounded-[3px] border border-rule bg-paper px-3.5 text-[0.9rem] text-ink
          transition-colors placeholder:text-faint hover:border-faint
          focus:border-gold focus:outline-none focus:ring-0"
        {...props}
      />
      {hint && <span className="mt-1.5 block text-[0.72rem] text-faint">{hint}</span>}
    </label>
  );
}
