import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/waste-log")({
  head: () => ({ meta: [{ title: "Waste Log — Café SaaS" }, { name: "description", content: "Logged inventory waste and spoilage." }] }),
  component: WasteLogPage,
});

type ApiWaste = { id: string; item?: { name?: string }; quantity?: number; reason?: string; createdAt?: string };

function WasteLogPage() {
  const { data, isError } = useQuery({ queryKey: ["inventory", "waste"], queryFn: () => api.get<ApiWaste[]>("/inventory/waste"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Waste Log" subtitle={isError ? "Sign in to view the waste log." : "Logged inventory waste and spoilage."} actions={<Button>Log waste</Button>} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={Trash2} title="No waste logged" text="Logged waste and spoilage will show up here." /> : (
          <Table head={["Item", "Quantity", "Reason", "Date"]}>
            {rows.map((w) => (
              <tr key={w.id} className="hover:bg-muted/40">
                <Td className="font-medium">{w.item?.name ?? "Item"}</Td>
                <Td className="num">{w.quantity ?? 0}</Td>
                <Td className="text-muted-foreground">{w.reason ?? "—"}</Td>
                <Td className="num text-muted-foreground">{w.createdAt ? new Date(w.createdAt).toLocaleDateString() : "—"}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
