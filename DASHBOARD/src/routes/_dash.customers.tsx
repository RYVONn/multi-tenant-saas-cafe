import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { Search, Users } from "lucide-react";
import { Avatar, Card, EmptyState, Input, PageHeader, Table, Td } from "@/components/ui-kit";
import { customers, fmt } from "@/lib/mock-data";

// No dedicated /customers endpoint exists on the backend yet — customers are
// implicitly `orders.customer_name` / loyalty card holders. Until a real
// customers endpoint ships, this runs on sample data derived the same way
// the mock seed does (one row per repeat customer).
export const Route = createFileRoute("/_dash/customers")({
  head: () => ({ meta: [{ title: "Customers — Café SaaS" }, { name: "description", content: "Customers who've ordered from you." }] }),
  component: CustomersPage,
});

function CustomersPage() {
  const [q, setQ] = useState("");
  const rows = customers.filter((c) => c.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Customers" subtitle="Everyone who has ordered from you." />
      <Card>
        <div className="flex items-center gap-2 border-b p-4">
          <div className="relative min-w-56 flex-1"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="Search customers" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {rows.length === 0 ? <EmptyState icon={Users} title="No customers found" /> : (
          <Table head={["Customer", "Phone", "Orders", "Total spent", "Last order"]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <Td><div className="flex items-center gap-2"><Avatar name={c.name} />{c.name}</div></Td>
                <Td className="num text-muted-foreground">{c.phone}</Td>
                <Td className="num">{c.orders}</Td>
                <Td className="num font-medium">{fmt(c.spent)}</Td>
                <Td className="num text-muted-foreground">{c.lastOrder}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
