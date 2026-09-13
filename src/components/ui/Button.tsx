"use client";

import { forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "quiet";
type Size = "sm" | "md" | "lg";

interface Props extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
}

const variants: Record<Variant, string> = {
  // Oxblood is reserved for the one primary action on a screen.
  primary:
    "bg-oxblood text-parchment hover:bg-oxblood-bright active:translate-y-px shadow-[0_1px_2px_rgba(34,32,28,0.16)]",
  secondary:
    "border border-rule text-ink hover:border-faint hover:bg-[color-mix(in_srgb,var(--color-ink)_4%,transparent)] active:translate-y-px",
  ghost:
    "text-ink-soft hover:text-ink hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)]",
  quiet: "text-muted hover:text-ink",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[0.78rem]",
  md: "h-10 px-5 text-[0.84rem]",
  lg: "h-12 px-7 text-[0.9rem]",
};

export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = "secondary", size = "md", className = "", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      className={`inline-flex items-center justify-center gap-2 rounded-[3px] font-medium tracking-[0.01em]
        transition-[background-color,color,border-color,transform] duration-150 ease-out
        disabled:pointer-events-none disabled:opacity-40
        ${variants[variant]} ${sizes[size]} ${className}`}
      {...props}
    />
  );
});

/** Square icon button used throughout the reader chrome. */
export const IconButton = forwardRef<
  HTMLButtonElement,
  React.ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }
>(function IconButton({ className = "", active, label, ...props }, ref) {
  return (
    <button
      ref={ref}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={`relative inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-[3px] text-[15px]
        transition-colors duration-150
        ${active ? "text-oxblood bg-[color-mix(in_srgb,var(--color-oxblood)_10%,transparent)]" : "text-muted hover:text-ink hover:bg-[color-mix(in_srgb,var(--color-ink)_5%,transparent)]"}
        disabled:pointer-events-none disabled:opacity-35 ${className}`}
      {...props}
    />
  );
});
