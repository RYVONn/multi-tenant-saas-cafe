import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CheckCircle2, ClipboardList, Coins, ShoppingBag, Circle } from "lucide-react";
import { Avatar, Badge, Card, Dialog, Input, Kpi, Label, PageHeader, Table, Td } from "@/components/ui-kit";
import { fmt, shifts, staff, type Shift } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dash/shift-history")({
  head: () => ({ meta: [{ title: "Shift History — Café SaaS" }, { name: "description", content: "Every staff shift with cash reconciliation." }, { property: "og:title", content: "Shift History — Café SaaS" }, { property: "og:description", content: "Every staff shift with cash reconciliation." }] }),
  component: ShiftHistory,
});

const who = (id: string) => staff.find((s) => s.id === id)!;
const orderCount = (s: Shift) => s.channels.pickup + s.channels.delivery + s.channels.drive;
const variance = (s: Shift) => (s.closing == null ? 0 : s.closing - s.expected);

function ShiftHistory() {
  const [from, setFrom] = useState("2026-09-28");
  const [to, setTo] = useState("2026-10-05");
  const [open, setOpen] = useState<Shift | null>(null);
  const rows = useMemo(() => shifts.filter((s) => s.date >= from && s.date <= to), [from, to]);

  return (
    <>
      <PageHeader title="Shift History" subtitle="Clock-ins, cash drawers and revenue per shift." actions={<div className="flex items-end gap-2"><div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Shifts in range" value={rows.length} icon={ClipboardList} />
        <Kpi label="Orders in range" value={rows.reduce((a, s) => a + orderCount(s), 0)} icon={ShoppingBag} tone="pink" />
        <Kpi label="Revenue in range" value={fmt(rows.reduce((a, s) => a + s.revenue, 0))} icon={Coins} tone="success" />
      </div>
      <Card>
        <Table head={["Employee", "Date", "Clock in / out", "Opening", "Expected", "Closing", "Variance", "Pickup / Delivery / Drive", "Revenue", "Status"]}>
          {rows.map((s) => {
            const v = variance(s), p = who(s.staffId);
            return (
              <tr key={s.id} onClick={() => setOpen(s)} className="cursor-pointer transition hover:bg-muted/50">
                <Td><div className="flex items-center gap-2"><Avatar name={p.name} /><div><div className="font-medium">{p.name}</div><div className="text-xs text-muted-foreground">{p.role}</div></div></div></Td>
                <Td className="num">{s.date}</Td>
                <Td className="num">{s.clockIn} – {s.clockOut ?? "…"}</Td>
                <Td className="num">{fmt(s.opening)}</Td>
                <Td className="num">{fmt(s.expected)}</Td>
                <Td className="num">{s.closing == null ? "—" : fmt(s.closing)}</Td>
                <Td className={cn("num font-semibold", v !== 0 ? "text-destructive" : "text-muted-foreground")}>{v > 0 ? "+" : ""}{fmt(v)}</Td>
                <Td className="num">{s.channels.pickup} / {s.channels.delivery} / {s.channels.drive}</Td>
                <Td className="num font-medium">{fmt(s.revenue)}</Td>
                <Td>{s.status === "working" ? <Badge tone="warning">Working</Badge> : <Badge tone="success">Completed</Badge>}</Td>
              </tr>
            );
          })}
        </Table>
        {rows.length === 0 && <p className="p-10 text-center text-sm text-muted-foreground">No shifts in this date range.</p>}
      </Card>
      {open && <ShiftReport s={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function Row({ k, v, strong, tone }: { k: string; v: string; strong?: boolean; tone?: string | undefined }) {
  return <div className={cn("flex justify-between py-1.5 text-sm", strong && "mt-1 border-t pt-2.5 font-semibold")}><span className="text-muted-foreground">{k}</span><span className={cn("num", tone)}>{v}</span></div>;
}

function ShiftReport({ s, onClose }: { s: Shift; onClose: () => void }) {
  const p = who(s.staffId), v = variance(s);
  const product = Math.round(s.revenue * 0.93), fees = s.channels.delivery * 25, disc = Math.round(s.revenue * 0.04), refunds = s.id === "sh3" ? 85 : 0;
  const cash = Math.round(s.revenue * 0.45), card = Math.round(s.revenue * 0.4), wallet = s.revenue - cash - card;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()} wide title={`Shift Report — ${p.name}`} description={`${s.date} · ${s.clockIn} – ${s.clockOut ?? "in progress"}`}>
      <div className="grid gap-3 sm:grid-cols-4">
        {[["Pickup", s.channels.pickup], ["Delivery", s.channels.delivery], ["Drive-thru", s.channels.drive]].map(([k, n]) => <div key={k} className="rounded-lg bg-muted p-3"><div className="text-xs text-muted-foreground">{k} orders</div><div className="num text-xl font-bold text-secondary">{n}</div></div>)}
        <div className="rounded-lg bg-primary p-3 text-primary-foreground"><div className="text-xs opacity-75">Total revenue</div><div className="num text-xl font-bold">{fmt(s.revenue)}</div></div>
      </div>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="p-4 shadow-none"><h3 className="mb-2 text-sm text-secondary">Revenue breakdown</h3>
          <Row k="Product revenue" v={fmt(product)} /><Row k="Delivery fees" v={fmt(fees)} /><Row k="Discounts" v={`−${fmt(disc)}`} /><Row k="Refunds" v={`−${fmt(refunds)}`} /><Row k="Net revenue" v={fmt(product + fees - disc - refunds)} strong />
        </Card>
        <Card className={cn("p-4 shadow-none", v !== 0 && "border-destructive/40")}><h3 className="mb-2 text-sm text-secondary">Cash reconciliation</h3>
          <Row k="Opening cash" v={fmt(s.opening)} /><Row k="Expected cash" v={fmt(s.expected)} /><Row k="Actual cash" v={s.closing == null ? "—" : fmt(s.closing)} /><Row k="Variance" v={fmt(v)} strong tone={v !== 0 ? "text-destructive" : undefined} />
          {s.varianceReason && <p className="mt-2 rounded-md bg-destructive-soft p-2 text-xs text-destructive">Reason: {s.varianceReason}</p>}
        </Card>
        {s.handover && (
          <Card className="p-4 shadow-none"><h3 className="mb-2 text-sm text-secondary">Handover</h3>
            <Row k="Previous" v={s.handover.prev} /><Row k="Next" v={s.handover.next} /><Row k="At" v={s.handover.at} />
            <div className="mt-2 flex gap-2">
              {[["Outgoing", s.handover.ackPrev], ["Incoming", s.handover.ackNext]].map(([k, ok]) => <Badge key={k as string} tone={ok ? "success" : "warning"}>{ok ? <CheckCircle2 className="h-3 w-3" /> : <Circle className="h-3 w-3" />}{k as string} {ok ? "acknowledged" : "pending"}</Badge>)}
            </div>
          </Card>
        )}
        <Card className="p-4 shadow-none"><h3 className="mb-2 text-sm text-secondary">Revenue by payment method</h3>
          <Row k="Cash" v={fmt(cash)} /><Row k="Card" v={fmt(card)} /><Row k="Wallet" v={fmt(wallet)} />
          <h3 className="mb-2 mt-4 text-sm text-secondary">Order status</h3>
          <div className="flex flex-wrap gap-2"><Badge tone="success">Completed {orderCount(s) - 2}</Badge><Badge tone="destructive">Cancelled 1</Badge><Badge tone="warning">Refunded {refunds ? 1 : 0}</Badge></div>
        </Card>
      </div>
    </Dialog>
  );
}
