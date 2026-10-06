import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Coins, Package, ShoppingBag, Users } from "lucide-react";
import { Card, Kpi, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { customers, fmt, orders as seedOrders } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/overview")({
  head: () => ({ meta: [{ title: "Overview — Café SaaS" }, { name: "description", content: "Today's orders, revenue and activity at a glance." }] }),
  component: OverviewPage,
});

// Combines /api/orders (today's orders) into simple KPIs. There's no
// dedicated analytics-for-overview endpoint on the backend yet, so this page
// deliberately stays a summary of what /orders already gives us rather than
// inventing one.
type ApiOrder = { id: string; status: string; total_amount?: number | string };

function OverviewPage() {
  const { data } = useQuery({
    queryKey: ["overview", "orders"],
    queryFn: () => api.get<ApiOrder[]>("/orders"),
    retry: 1,
  });
  const todays = data ?? seedOrders.map((o) => ({ id: o.id, status: o.status, total_amount: o.total }));
  const completed = todays.filter((o) => o.status === "completed" || o.status === "complete");
  const revenue = completed.reduce((s, o) => s + Number(o.total_amount ?? 0), 0);

  return (
    <>
      <PageHeader title="Overview" subtitle="A quick snapshot of today's business." />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Orders Today" value={todays.length} icon={ShoppingBag} />
        <Kpi label="Completed" value={completed.length} icon={Package} tone="success" />
        <Kpi label="Revenue Today" value={fmt(Math.round(revenue))} icon={Coins} tone="success" />
        <Kpi label="Customers" value={customers.length} icon={Users} tone="pink" />
      </div>
      <Card className="p-6">
        <h2 className="mb-1 font-heading text-lg font-bold text-secondary">Welcome back</h2>
        <p className="text-sm text-muted-foreground">Use the sidebar to manage orders, inventory, staff and more. This overview combines live order data where the backend is reachable, and falls back to sample data otherwise.</p>
      </Card>
    </>
  );
}
