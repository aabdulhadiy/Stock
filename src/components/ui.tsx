import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Tailwind UI primitives shared across the app. Deliberately free of hooks so
 * they can be rendered from server components; anything interactive lives in
 * its own `"use client"` file.
 *
 * §14: desktop is primary but the warehouseman works from a phone, so tables
 * scroll horizontally and touch targets stay at least 40px tall.
 */

export function Button({
  className,
  variant = "primary",
  size = "md",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "success";
  size?: "sm" | "md" | "lg";
}) {
  const variants = {
    primary: "bg-primary text-primary-foreground hover:bg-indigo-700",
    secondary: "bg-surface text-foreground border border-border hover:bg-slate-50",
    danger: "bg-red-600 text-white hover:bg-red-700",
    success: "bg-emerald-600 text-white hover:bg-emerald-700",
    ghost: "text-foreground hover:bg-slate-100",
  };
  const sizes = {
    sm: "px-2.5 py-1.5 text-xs min-h-8",
    md: "px-4 py-2 text-sm min-h-10",
    lg: "px-5 py-2.5 text-base min-h-11",
  };
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors",
        "disabled:opacity-50 disabled:pointer-events-none",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
        variants[variant],
        sizes[size],
        className,
      )}
      {...props}
    />
  );
}

const fieldBase =
  "w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-foreground " +
  "outline-none transition-colors focus:border-primary focus:ring-2 focus:ring-primary/20 " +
  "disabled:bg-slate-50 disabled:text-muted aria-[invalid=true]:border-red-500";

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(fieldBase, "min-h-10", className)} {...props} />;
}

export function Select({
  className,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn(fieldBase, "min-h-10", className)} {...props} />;
}

export function Textarea({
  className,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(fieldBase, className)} rows={3} {...props} />;
}

export function Label({
  className,
  required,
  children,
  ...props
}: React.LabelHTMLAttributes<HTMLLabelElement> & { required?: boolean }) {
  return (
    <label className={cn("block text-sm font-medium mb-1", className)} {...props}>
      {children}
      {required && <span className="text-red-600 ml-0.5">*</span>}
    </label>
  );
}

export function Hint({ children }: { children: React.ReactNode }) {
  return <p className="text-xs text-muted mt-1">{children}</p>;
}

export function FieldError({ children }: { children?: React.ReactNode }) {
  if (!children) return null;
  return (
    <p className="text-xs text-red-600 mt-1" role="alert">
      {children}
    </p>
  );
}

/** Label + control + error, the standard form row. */
export function Field({
  label,
  htmlFor,
  required,
  error,
  hint,
  children,
  className,
}: {
  label: string;
  htmlFor?: string;
  required?: boolean;
  error?: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <Label htmlFor={htmlFor} required={required}>
        {label}
      </Label>
      {children}
      {hint && !error && <Hint>{hint}</Hint>}
      <FieldError>{error}</FieldError>
    </div>
  );
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("rounded-lg border border-border bg-surface shadow-sm", className)}
      {...props}
    />
  );
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "px-5 py-3.5 border-b border-border flex items-center justify-between gap-3 flex-wrap",
        className,
      )}
      {...props}
    />
  );
}

export function CardTitle({
  className,
  ...props
}: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn("text-base font-semibold", className)} {...props} />;
}

export function CardBody({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-5", className)} {...props} />;
}

export type BadgeColor =
  | "slate"
  | "green"
  | "red"
  | "blue"
  | "amber"
  | "indigo"
  | "emerald";

export function Badge({
  className,
  color = "slate",
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { color?: BadgeColor }) {
  const colors: Record<BadgeColor, string> = {
    slate: "bg-slate-100 text-slate-700",
    green: "bg-green-100 text-green-800",
    red: "bg-red-100 text-red-800",
    blue: "bg-blue-100 text-blue-800",
    amber: "bg-amber-100 text-amber-800",
    indigo: "bg-indigo-100 text-indigo-800",
    emerald: "bg-emerald-100 text-emerald-800",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap",
        colors[color],
        className,
      )}
      {...props}
    />
  );
}

export function Alert({
  children,
  variant = "info",
}: {
  children: React.ReactNode;
  variant?: "info" | "error" | "success" | "warning";
}) {
  const variants = {
    info: "bg-blue-50 text-blue-900 border-blue-200",
    error: "bg-red-50 text-red-900 border-red-200",
    success: "bg-green-50 text-green-900 border-green-200",
    warning: "bg-amber-50 text-amber-900 border-amber-200",
  };
  return (
    <div
      className={cn("rounded-md border px-4 py-3 text-sm", variants[variant])}
      role={variant === "error" ? "alert" : undefined}
    >
      {children}
    </div>
  );
}

export function Table({ className, ...props }: React.TableHTMLAttributes<HTMLTableElement>) {
  return (
    <div className="overflow-x-auto">
      <table className={cn("w-full text-sm border-collapse", className)} {...props} />
    </div>
  );
}

export function Th({
  className,
  numeric,
  ...props
}: React.ThHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <th
      className={cn(
        "font-medium text-muted px-3 py-2.5 border-b border-border whitespace-nowrap",
        numeric ? "text-right" : "text-left",
        className,
      )}
      {...props}
    />
  );
}

export function Td({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 border-b border-border align-middle",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

/** Footer row for column totals. */
export function Tf({
  className,
  numeric,
  ...props
}: React.TdHTMLAttributes<HTMLTableCellElement> & { numeric?: boolean }) {
  return (
    <td
      className={cn(
        "px-3 py-2.5 border-t-2 border-border font-semibold",
        numeric && "text-right tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="text-center py-12 px-4 text-muted">
      <p className="font-medium text-foreground">{title}</p>
      {hint && <p className="text-sm mt-1 max-w-md mx-auto">{hint}</p>}
      {action && <div className="mt-4 flex justify-center">{action}</div>}
    </div>
  );
}

export function PageHeader({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6 flex items-start justify-between gap-4 flex-wrap">
      <div className="min-w-0">
        <h1 className="text-2xl font-bold tracking-tight">{title}</h1>
        {subtitle && <p className="text-sm text-muted mt-1">{subtitle}</p>}
      </div>
      {children && <div className="flex items-center gap-2 flex-wrap">{children}</div>}
    </header>
  );
}

/** Dashboard metric tile. */
export function StatTile({
  label,
  value,
  sub,
  tone = "default",
  href,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "negative" | "warning";
  href?: string;
}) {
  const tones = {
    default: "text-foreground",
    positive: "text-emerald-700",
    negative: "text-red-700",
    warning: "text-amber-700",
  };
  const body = (
    <>
      <p className="text-xs font-medium text-muted uppercase tracking-wide">{label}</p>
      <p className={cn("text-2xl font-bold mt-1 tabular-nums", tones[tone])}>{value}</p>
      {sub && <p className="text-xs text-muted mt-1">{sub}</p>}
    </>
  );
  if (href) {
    return (
      <a
        href={href}
        className="block rounded-lg border border-border bg-surface p-4 shadow-sm transition-colors hover:border-primary/40"
      >
        {body}
      </a>
    );
  }
  return <div className="rounded-lg border border-border bg-surface p-4 shadow-sm">{body}</div>;
}

/** Horizontal progress bar, used by the break-even widget (§9.4). */
export function Progress({
  ratio,
  label,
  tone = "primary",
}: {
  ratio: number;
  label?: string;
  tone?: "primary" | "success" | "warning";
}) {
  const pct = Math.max(0, Math.min(1, ratio)) * 100;
  const tones = {
    primary: "bg-primary",
    success: "bg-emerald-600",
    warning: "bg-amber-500",
  };
  return (
    <div>
      <div
        className="h-2.5 w-full rounded-full bg-slate-200 overflow-hidden"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div className={cn("h-full rounded-full transition-all", tones[tone])} style={{ width: `${pct}%` }} />
      </div>
      {label && <p className="text-xs text-muted mt-1.5">{label}</p>}
    </div>
  );
}

/** A definition row — label on the left, value on the right. */
export function DetailRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 border-b border-border last:border-0">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="text-sm font-medium text-right tabular-nums">{children}</dd>
    </div>
  );
}

export function Toolbar({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-end gap-3 px-5 py-3.5 border-b border-border bg-slate-50/60">
      {children}
    </div>
  );
}

/** Thumbnail with a graceful placeholder — most products have no photo at first. */
export function Thumb({
  src,
  alt,
  size = 36,
}: {
  src: string | null;
  alt: string;
  size?: number;
}) {
  if (!src) {
    return (
      <div
        className="rounded bg-slate-100 border border-border flex items-center justify-center text-muted text-[10px] shrink-0"
        style={{ width: size, height: size }}
        aria-hidden
      >
        —
      </div>
    );
  }
  return (
    // Uploads are served by our own authenticated route handler (§14), which
    // next/image's optimizer cannot reach — so a plain <img> is correct here.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={src}
      alt={alt}
      width={size}
      height={size}
      className="rounded object-cover border border-border shrink-0 bg-white"
      style={{ width: size, height: size }}
    />
  );
}
