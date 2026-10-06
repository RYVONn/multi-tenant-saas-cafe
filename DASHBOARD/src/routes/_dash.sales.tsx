import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Receipt } from "lucide-react";
import { Badge, Card, EmptyState, Kpi, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { fmt, sales as seed, saleTotal, salePaid } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/sales")({
  head: () => ({ meta: [{ title: "Sales — Café SaaS" }, { name: "description", content: "Invoices and payment status." }] }),
  component: SalesPage,
});

type ApiSale = { id: string; invoice?: string; totalAmount?: number; paidAmount?: number; status?: string };

function SalesPage() {
  const { data, isError } = useQuery({ queryKey: ["inventory", "sales"], queryFn: () => api.get<ApiSale[]>("/inventory/sales"), retry: 1 });
  const rows = data ?? seed.map((s) => ({ id: s.id, invoice: s.invoice, totalAmount: saleTotal(s), paidAmount: salePaid(s), status: s.status }));
  const total = rows.reduce((a, s) => a + (s.totalAmount ?? 0), 0);
  const paid = rows.reduce((a, s) => a + (s.paidAmount ?? 0), 0);

  return (
    <>
      <PageHeader title="Sales" subtitle={isError ? "Showing sample data — backend not reachable." : "Invoices and payment status."} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Invoices" value={rows.length} icon={Receipt} />
        <Kpi label="Total billed" value={fmt(total)} icon={Receipt} />
        <Kpi label="Collected" value={fmt(paid)} icon={Receipt} tone="success" />
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState icon={Receipt} title="No sales yet" /> : (
          <Table head={["Invoice", "Total", "Paid", "Status"]}>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-muted/40">
                <Td className="num font-medium">{s.invoice}</Td>
                <Td className="num">{fmt(s.totalAmount ?? 0)}</Td>
                <Td className="num">{fmt(s.paidAmount ?? 0)}</Td>
                <Td>{s.status === "paid" ? <Badge tone="success">Paid</Badge> : s.status === "partial" ? <Badge tone="warning">Partial</Badge> : <Badge tone="destructive">Unpaid</Badge>}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
