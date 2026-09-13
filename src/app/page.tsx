import Link from "next/link";
import { currentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { HeroBook } from "@/components/landing/HeroBook";

export default async function LandingPage() {
  // A returning reader shouldn't have to walk past the front door.
  if (await currentUser()) redirect("/library");

  return (
    <main className="paper-grain min-h-dvh bg-parchment">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 py-7 sm:px-10">
        <span className="font-display text-[1.45rem] font-semibold tracking-[0.03em] text-ink">
          Folio
        </span>
        <nav className="flex items-center gap-7 text-[0.82rem] text-muted">
          <Link href="/login" className="transition-colors hover:text-ink">
            Sign in
          </Link>
          <Link
            href="/signup"
            className="rounded-[3px] border border-rule px-4 py-2 transition-colors hover:border-faint hover:text-ink"
          >
            Start reading
          </Link>
        </nav>
      </header>

      <section className="mx-auto grid max-w-6xl gap-16 px-6 pb-24 pt-12 sm:px-10 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1fr)] lg:gap-14 lg:pt-20">
        <div className="flex flex-col justify-center">
          <p className="label mb-7">A reading companion</p>

          <h1 className="font-display text-[clamp(3rem,7.5vw,4.75rem)] font-light leading-[1.04] tracking-[-0.015em] text-ink">
            Read.
            <br />
            Understand.
            <br />
            <span className="italic text-oxblood">Remember.</span>
          </h1>

          <p className="mt-8 max-w-[30rem] text-[1.0625rem] leading-[1.7] text-ink-soft">
            Your books, your thoughts, and an AI that understands what you&rsquo;re reading —
            not a chatbot with a PDF attached.
          </p>

          <div className="mt-11 flex flex-wrap items-center gap-5">
            <Link
              href="/signup"
              className="inline-flex h-12 items-center rounded-[3px] bg-oxblood px-8 text-[0.9rem] font-medium tracking-[0.01em] text-parchment shadow-[0_1px_2px_rgba(34,32,28,0.18)] transition-colors hover:bg-oxblood-bright"
            >
              Start reading
            </Link>
            <Link
              href="/login"
              className="text-[0.9rem] text-muted underline decoration-rule underline-offset-[5px] transition-colors hover:text-ink hover:decoration-faint"
            >
              I already have books here
            </Link>
          </div>

          <dl className="mt-16 grid max-w-lg grid-cols-3 gap-8 border-t border-rule pt-8">
            {[
              ["Hold space", "Ask out loud, mid-page"],
              ["Listen", "Narration that follows the line"],
              ["Return", "Exactly where you stopped"],
            ].map(([term, detail]) => (
              <div key={term}>
                <dt className="font-display text-[1.02rem] font-semibold text-ink">{term}</dt>
                <dd className="mt-1.5 text-[0.78rem] leading-[1.5] text-muted">{detail}</dd>
              </div>
            ))}
          </dl>
        </div>

        <HeroBook />
      </section>

      <footer className="border-t border-rule">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-6 py-8 text-[0.76rem] text-faint sm:flex-row sm:items-center sm:justify-between sm:px-10">
          <span className="font-display text-[0.95rem] tracking-[0.03em] text-muted">Folio</span>
          <span>PDF and EPUB. Your library stays yours.</span>
        </div>
      </footer>
    </main>
  );
}
