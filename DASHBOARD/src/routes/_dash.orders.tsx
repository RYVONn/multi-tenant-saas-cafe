import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ChevronRight, Clock, Inbox, X } from "lucide-react";
import { Badge, Card, PageHeader } from "@/components/ui-kit";
import { orders as seed, fmt, type Order, type OrderStatus, type OrderType } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dash/orders")({
  head: () => ({ meta: [{ title: "Orders — Café SaaS" }, { name: "description", content: "Live order board from new to completed." }, { property: "og:title", content: "Orders — Café SaaS" }, { property: "og:description", content: "Live order board from new to completed." }] }),
  component: OrdersPage,
});

const flow: { key: OrderStatus; label: string; dot: string }[] = [
  { key: "new", label: "New", dot: "bg-status-new" },
  { key: "accepted", label: "Accepted", dot: "bg-status-accepted" },
  { key: "preparing", label: "Preparing", dot: "bg-status-preparing" },
  { key: "ready", label: "Ready", dot: "bg-status-ready" },
  { key: "out", label: "Out for Delivery / Pickup", dot: "bg-status-out" },
  { key: "completed", label: "Completed", dot: "bg-status-complete" },
];
const typeStyle: Record<OrderType, string> = { pickup: "bg-type-pickup", delivery: "bg-type-delivery", "drive-thru": "bg-type-drive" };

function OrdersPage() {
  const [list, setList] = useState<Order[]>(seed);
  const move = (id: string, to: OrderStatus) => setList((l) => l.map((o) => (o.id === id ? { ...o, status: to } : o)));
  const next = (s: OrderStatus) => flow[flow.findIndex((f) => f.key === s) + 1]?.key;
  const cancelled = list.filter((o) => o.status === "cancelled");

  return (
    <>
      <PageHeader title="Orders" subtitle={`${list.filter((o) => !["completed", "cancelled"].includes(o.status)).length} active orders right now`} actions={<div className="flex gap-2">{(["pickup", "delivery", "drive-thru"] as OrderType[]).map((t) => <span key={t} className={cn("rounded-full px-2.5 py-1 text-xs font-medium capitalize text-primary-foreground", typeStyle[t])}>{t}</span>)}</div>} />
      <div className="flex gap-4 overflow-x-auto pb-4">
        {flow.map((col) => <Column key={col.key} label={col.label} dot={col.dot} orders={list.filter((o) => o.status === col.key)} onAdvance={(id) => { const n = next(col.key); if (n) move(id, n); }} onCancel={(id) => move(id, "cancelled")} last={col.key === "completed"} />)}
        <div className="w-px shrink-0 bg-border" />
        <Column label="Cancelled" dot="bg-status-cancelled" orders={cancelled} muted />
      </div>
    </>
  );
}

function Column({ label, dot, orders, onAdvance, onCancel, last, muted }: { label: string; dot: string; orders: Order[]; onAdvance?: (id: string) => void; onCancel?: (id: string) => void; last?: boolean; muted?: boolean }) {
  return (
    <div className={cn("flex w-72 shrink-0 flex-col rounded-xl p-2", muted ? "bg-destructive-soft" : "bg-muted/70")}>
      <div className="flex items-center gap-2 px-2 py-2">
        <span className={cn("h-2 w-2 rounded-full", dot)} />
        <span className="text-sm font-semibold text-secondary">{label}</span>
        <span className="num ms-auto rounded-full bg-card px-2 text-xs font-semibold text-muted-foreground">{orders.length}</span>
      </div>
      <div className="flex min-h-40 flex-col gap-2">
        {orders.length === 0 && <div className="flex flex-1 flex-col items-center justify-center rounded-lg border border-dashed py-8 text-xs text-muted-foreground"><Inbox className="mb-1 h-4 w-4" />No orders</div>}
        {orders.map((o) => (
          <Card key={o.id} className={cn("p-3 transition hover:shadow-lift", muted && "opacity-75")}>
            <div className="flex items-center justify-between">
              <span className="num font-heading font-bold text-secondary">#{o.number}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase text-primary-foreground", typeStyle[o.type])}>{o.type}</span>
            </div>
            <div className="mt-1 text-sm">{o.customer}</div>
            <ul className="mt-2 space-y-0.5 text-xs text-muted-foreground">{o.items.map((i) => <li key={i.name}><span className="num">{i.qty}×</span> {i.name}</li>)}</ul>
            <div className="mt-3 flex items-center justify-between border-t pt-2">
              <span className="num text-sm font-semibold">{fmt(o.total)}</span>
              <span className="flex items-center gap-1 text-xs text-muted-foreground"><Clock className="h-3 w-3" />{o.minutesAgo}m</span>
            </div>
            {onAdvance && !last && (
              <div className="mt-2 flex gap-1.5">
                <button onClick={() => onAdvance(o.id)} className="flex flex-1 cursor-pointer items-center justify-center gap-1 rounded-md bg-primary py-1.5 text-xs font-medium text-primary-foreground hover:bg-navy-mid">Advance <ChevronRight className="h-3 w-3 rtl:rotate-180" /></button>
                <button onClick={() => onCancel?.(o.id)} title="Cancel" className="cursor-pointer rounded-md border px-2 text-muted-foreground hover:border-destructive hover:text-destructive"><X className="h-3 w-3" /></button>
              </div>
            )}
            {last && <Badge tone="success" className="mt-2">Completed</Badge>}
          </Card>
        ))}
      </div>
    </div>
  );
}
