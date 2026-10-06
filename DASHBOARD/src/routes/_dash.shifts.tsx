import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Clock } from "lucide-react";
import { Avatar, Badge, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/shifts")({
  head: () => ({ meta: [{ title: "Shifts — Café SaaS" }, { name: "description", content: "Who's currently clocked in." }] }),
  component: ShiftsPage,
});

type ApiShift = { id: string; staff?: { shift_name?: string }; type?: string; openedAt: string; status: string };

function ShiftsPage() {
  const { data, isError } = useQuery({ queryKey: ["shifts", "active"], queryFn: () => api.get<ApiShift[]>("/inventory/shifts/active"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Shifts" subtitle={isError ? "Sign in to view active shifts." : "Who's currently clocked in."} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={Clock} title="No active shifts" text="When staff clock in, they'll show up here." /> : (
          <Table head={["Staff", "Type", "Opened", "Status"]}>
            {rows.map((s) => (
              <tr key={s.id} className="hover:bg-muted/40">
                <Td><div className="flex items-center gap-2"><Avatar name={s.staff?.shift_name ?? "Staff"} />{s.staff?.shift_name ?? "Staff"}</div></Td>
                <Td className="capitalize text-muted-foreground">{s.type ?? "—"}</Td>
                <Td className="num">{new Date(s.openedAt).toLocaleString()}</Td>
                <Td><Badge tone="warning">Working</Badge></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
