import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Truck } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/suppliers")({
  head: () => ({ meta: [{ title: "Suppliers — Café SaaS" }, { name: "description", content: "Vendors you purchase inventory from." }] }),
  component: SuppliersPage,
});

type ApiSupplier = { id: string; name: string; phone?: string; email?: string };

function SuppliersPage() {
  const { data, isError } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get<ApiSupplier[]>("/inventory/suppliers"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Suppliers" subtitle={isError ? "Sign in to view suppliers." : "Vendors you purchase inventory from."} actions={<Button>New supplier</Button>} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={Truck} title="No suppliers yet" text="Add a supplier to start receiving purchases against them." /> : (
          <Table head={["Name", "Phone", "Email", ""]}>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-muted/40">
                <Td className="font-medium">{s.name}</Td>
                <Td className="num text-muted-foreground">{s.phone ?? "—"}</Td>
                <Td className="text-muted-foreground">{s.email ?? "—"}</Td>
                <Td><Button size="sm" variant="outline">Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
