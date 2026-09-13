import type { Metadata, Viewport } from "next";
import { Cormorant_Garamond, Inter } from "next/font/google";
import "./globals.css";

const cormorant = Cormorant_Garamond({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-cormorant",
  display: "swap",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Folio — Read. Understand. Remember.",
  description:
    "A reading experience designed around the way you actually learn. Your books, your thoughts, and an AI that understands what you're reading.",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f3ea" },
    { media: "(prefers-color-scheme: dark)", color: "#15130f" },
  ],
  width: "device-width",
  initialScale: 1,
  // Pinch-zoom on the book is handled in the reader; the page chrome shouldn't zoom.
  maximumScale: 5,
};

/**
 * Applies the stored theme before first paint, so there is never a flash.
 *
 * Light is the default rather than the system preference: a first-time visitor
 * meets the landing and sign-in pages before they have expressed any choice,
 * and those pages are typeset as paper. Following the OS into dark mode there
 * means the first impression of a reading app is one nobody asked for. Once a
 * reader picks a theme — light, dark, or explicitly follow-the-system — that
 * choice is what persists.
 */
const themeScript = `(function(){try{
var t=localStorage.getItem("folio-theme")||"light";
var d=t==="dark"||(t==="system"&&matchMedia("(prefers-color-scheme: dark)").matches);
document.documentElement.setAttribute("data-theme",d?"dark":"light");
}catch(e){document.documentElement.setAttribute("data-theme","light")}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${cormorant.variable} ${inter.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
