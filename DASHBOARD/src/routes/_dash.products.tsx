import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Coffee, Search } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { products as seed, fmt } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/products")({
  head: () => ({ meta: [{ title: "Products — Café SaaS" }, { name: "description", content: "Menu items for sale in-store and online." }] }),
  component: ProductsPage,
});

type ApiProduct = { id: string; name: string; category?: { name: string } | string; price?: number | string; isAvailable?: boolean };

function ProductsPage() {
  const [q, setQ] = useState("");
  const { data, isError } = useQuery({
    queryKey: ["products"],
    queryFn: () => api.get<ApiProduct[]>("/products"),
    retry: 1,
  });
  const rows = (data ?? seed.map((p) => ({ id: p.id, name: p.name, category: p.category, price: p.price, isAvailable: true })))
    .filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <>
      <PageHeader title="Products" subtitle={isError ? "Showing sample data — backend not reachable." : "Your menu items."} actions={<Button>New product</Button>} />
      <Card>
        <div className="flex items-center gap-2 border-b p-4">
          <div className="relative min-w-56 flex-1"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        </div>
        {rows.length === 0 ? <EmptyState icon={Coffee} title="No products" text="Add your first menu item to get started." /> : (
          <Table head={["Name", "Category", "Price", "Status", ""]}>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-muted/40">
                <Td className="font-medium">{p.name}</Td>
                <Td className="text-muted-foreground">{typeof p.category === "string" ? p.category : p.category?.name ?? "—"}</Td>
                <Td className="num">{fmt(Number(p.price ?? 0))}</Td>
                <Td>{p.isAvailable === false ? <Badge tone="destructive">Hidden</Badge> : <Badge tone="success">Available</Badge>}</Td>
                <Td><Button size="sm" variant="outline">Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
