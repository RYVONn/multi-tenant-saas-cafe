import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History, Search } from "lucide-react";
import { Badge, Card, EmptyState, Input, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { orders as seed, fmt, type Order } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/order-history")({
  head: () => ({ meta: [{ title: "Order History — Café SaaS" }, { name: "description", content: "Completed and cancelled orders." }] }),
  component: OrderHistoryPage,
});

type ApiOrder = { id: string; number?: number; customer_name?: string; status?: string; total_amount?: number | string; created_at?: string };
function mapOrder(o: ApiOrder): Order {
  return {
    id: String(o.id), number: o.number ?? Number(o.id), customer: o.customer_name ?? "Customer",
    type: "pickup", status: (o.status === "complete" ? "completed" : o.status) as Order["status"],
    items: [], total: Number(o.total_amount ?? 0),
    minutesAgo: o.created_at ? Math.round((Date.now() - new Date(o.created_at).getTime()) / 60000) : 0,
  };
}

function OrderHistoryPage() {
  const [q, setQ] = useState("");
  const { data } = useQuery({
    queryKey: ["orders", "history"],
    queryFn: async () => (await api.get<ApiOrder[]>("/orders/history")).map(mapOrder),
    retry: 1,
  });
  const list = (data ?? seed).filter((o) => o.status === "completed" || o.status === "cancelled");
  const rows = useMemo(() => list.filter((o) => o.customer.toLowerCase().includes(q.toLowerCase()) || String(o.number).includes(q)), [list, q]);

  return (
    <>
      <PageHeader title="Order History" subtitle="Every completed or cancelled order." />
      <Card>
        <div className="flex items-center gap-2 border-b p-4">
          <div className="relative min-w-56 flex-1"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="Search by customer or order #" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {rows.length === 0 ? <EmptyState icon={History} title="No orders yet" text="Completed and cancelled orders will show up here." /> : (
          <Table head={["Order #", "Customer", "Total", "Status"]}>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td className="num font-medium">#{o.number}</Td>
                <Td>{o.customer}</Td>
                <Td className="num">{fmt(o.total)}</Td>
                <Td>{o.status === "completed" ? <Badge tone="success">Completed</Badge> : <Badge tone="destructive">Cancelled</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
