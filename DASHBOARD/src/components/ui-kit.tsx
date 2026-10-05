import * as DialogP from "@radix-ui/react-dialog";
import * as TabsP from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { X } from "lucide-react";
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonV = cva("inline-flex items-center justify-center gap-2 rounded-lg text-sm font-medium transition-all disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/40 cursor-pointer", {
  variants: {
    variant: {
      primary: "bg-primary text-primary-foreground hover:bg-navy-mid shadow-sm",
      outline: "border bg-card hover:bg-muted",
      ghost: "hover:bg-muted",
      accent: "bg-accent text-accent-foreground hover:bg-pink",
      destructive: "bg-destructive text-destructive-foreground hover:opacity-90",
    },
    size: { sm: "h-8 px-3 text-xs", md: "h-10 px-4", icon: "h-8 w-8" },
  },
  defaultVariants: { variant: "primary", size: "md" },
});
export function Button({ className, variant, size, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof buttonV>) {
  return <button className={cn(buttonV({ variant, size }), className)} {...p} />;
}

export function Card({ className, children, ...p }: { className?: string; children: ReactNode } & React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-xl border bg-card shadow-card", className)} {...p}>{children}</div>;
}

const badgeV = cva("inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap", {
  variants: {
    tone: {
      neutral: "bg-muted text-muted-foreground",
      primary: "bg-primary/10 text-primary",
      success: "bg-success-soft text-success",
      warning: "bg-warning-soft text-warning",
      destructive: "bg-destructive-soft text-destructive",
      pink: "bg-accent/40 text-accent-foreground",
      platform: "bg-platform-soft text-platform",
    },
  },
  defaultVariants: { tone: "neutral" },
});
export type Tone = NonNullable<VariantProps<typeof badgeV>["tone"]>;
export function Badge({ tone, className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn(badgeV({ tone }), className)}>{children}</span>;
}

export function Input({ className, ...p }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn("h-10 w-full rounded-lg border bg-card px-3 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/15", className)} {...p} />;
}
export function Select({ className, ...p }: SelectHTMLAttributes<HTMLSelectElement>) {
  return <select className={cn("h-10 rounded-lg border bg-card px-3 text-sm outline-none focus:border-ring", className)} {...p} />;
}
export function Label({ children }: { children: ReactNode }) {
  return <label className="mb-1.5 block text-xs font-medium text-muted-foreground">{children}</label>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-2xl text-secondary">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

const kpiTone: Record<string, string> = { neutral: "bg-primary/10 text-primary", warning: "bg-warning-soft text-warning", destructive: "bg-destructive-soft text-destructive", success: "bg-success-soft text-success", pink: "bg-accent/40 text-accent-foreground" };
export function Kpi({ label, value, icon: Icon, tone = "neutral", active, onClick, hint }: { label: string; value: ReactNode; icon: React.ComponentType<{ className?: string }>; tone?: keyof typeof kpiTone; active?: boolean; onClick?: () => void; hint?: string }) {
  const C = onClick ? "button" : "div";
  return (
    <C onClick={onClick} className={cn("group rounded-xl border bg-card p-4 text-start shadow-card transition-all", onClick && "cursor-pointer hover:-translate-y-0.5 hover:shadow-lift", active && "ring-2 ring-primary ring-offset-2 ring-offset-cream")}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        <span className={cn("grid h-8 w-8 place-items-center rounded-lg", kpiTone[tone])}><Icon className="h-4 w-4" /></span>
      </div>
      <div className="num mt-2 text-2xl font-bold text-secondary">{value}</div>
      {hint && <div className="mt-0.5 text-xs text-muted-foreground">{hint}</div>}
    </C>
  );
}

export function Dialog({ open, onOpenChange, title, description, children, wide }: { open: boolean; onOpenChange: (o: boolean) => void; title: ReactNode; description?: ReactNode; children: ReactNode; wide?: boolean }) {
  return (
    <DialogP.Root open={open} onOpenChange={onOpenChange}>
      <DialogP.Portal>
        <DialogP.Overlay className="fixed inset-0 z-50 bg-secondary/40 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogP.Content className={cn("fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border bg-card p-6 shadow-lift data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95", wide ? "max-w-4xl" : "max-w-lg")}>
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <DialogP.Title className="font-heading text-lg font-bold text-secondary">{title}</DialogP.Title>
              {description ? <DialogP.Description className="mt-0.5 text-sm text-muted-foreground">{description}</DialogP.Description> : <DialogP.Description className="sr-only">Details</DialogP.Description>}
            </div>
            <DialogP.Close className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></DialogP.Close>
          </div>
          {children}
        </DialogP.Content>
      </DialogP.Portal>
    </DialogP.Root>
  );
}

export const Tabs = TabsP.Root;
export const TabsContent = TabsP.Content;
export function TabsList({ items }: { items: { value: string; label: string }[] }) {
  return (
    <TabsP.List className="mb-4 inline-flex flex-wrap gap-1 rounded-lg bg-muted p-1">
      {items.map((i) => (
        <TabsP.Trigger key={i.value} value={i.value} className="cursor-pointer rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition data-[state=active]:bg-card data-[state=active]:text-primary data-[state=active]:shadow-sm">
          {i.label}
        </TabsP.Trigger>
      ))}
    </TabsP.List>
  );
}

export function Table({ head, children, className }: { head: ReactNode[]; children: ReactNode; className?: string }) {
  return (
    <div className={cn("overflow-x-auto", className)}>
      <table className="w-full text-sm">
        <thead><tr className="border-b bg-muted/60">{head.map((h, i) => <th key={i} className="whitespace-nowrap px-4 py-2.5 text-start text-xs font-semibold uppercase tracking-wide text-muted-foreground">{h}</th>)}</tr></thead>
        <tbody className="divide-y">{children}</tbody>
      </table>
    </div>
  );
}
export const Td = ({ children, className }: { children?: ReactNode; className?: string }) => <td className={cn("whitespace-nowrap px-4 py-3", className)}>{children}</td>;

export function EmptyState({ icon: Icon, title, text }: { icon: React.ComponentType<{ className?: string }>; title: string; text?: string }) {
  return (
    <div className="flex flex-col items-center justify-center px-6 py-14 text-center">
      <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-muted text-muted-foreground"><Icon className="h-5 w-5" /></span>
      <p className="font-medium text-secondary">{title}</p>
      {text && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{text}</p>}
    </div>
  );
}

export function Avatar({ name, className }: { name: string; className?: string }) {
  const ini = name.split(" ").map((p) => p[0]).slice(0, 2).join("");
  return <span className={cn("grid h-8 w-8 shrink-0 place-items-center rounded-full bg-accent/50 text-xs font-bold text-primary", className)}>{ini}</span>;
}
