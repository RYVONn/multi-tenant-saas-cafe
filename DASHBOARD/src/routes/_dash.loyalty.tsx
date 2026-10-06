import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Wallet } from "lucide-react";
import { Avatar, Card, EmptyState, Kpi, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/loyalty")({
  head: () => ({ meta: [{ title: "Loyalty — Café SaaS" }, { name: "description", content: "Customer loyalty cards and points." }] }),
  component: LoyaltyPage,
});

type ApiCard = { id: string; customer_name?: string; user?: { name?: string }; points?: number; tier?: string };

function LoyaltyPage() {
  const { data, isError } = useQuery({ queryKey: ["loyalty", "cards"], queryFn: () => api.get<ApiCard[]>("/loyalty/cards"), retry: 1 });
  const rows = data ?? [];
  const totalPoints = rows.reduce((s, c) => s + (c.points ?? 0), 0);

  return (
    <>
      <PageHeader title="Loyalty" subtitle={isError ? "Sign in as an owner/manager to view loyalty cards." : "Customer loyalty cards and points."} />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="Active Cards" value={rows.length} icon={Wallet} />
        <Kpi label="Points Issued" value={totalPoints.toLocaleString()} icon={Wallet} tone="pink" />
      </div>
      <Card>
        {rows.length === 0 ? <EmptyState icon={Wallet} title="No loyalty cards" text="Cards appear here once customers start earning points." /> : (
          <Table head={["Customer", "Tier", "Points"]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <Td><div className="flex items-center gap-2"><Avatar name={c.user?.name ?? c.customer_name ?? "Customer"} />{c.user?.name ?? c.customer_name ?? "Customer"}</div></Td>
                <Td className="capitalize text-muted-foreground">{c.tier ?? "standard"}</Td>
                <Td className="num font-medium">{c.points ?? 0}</Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
