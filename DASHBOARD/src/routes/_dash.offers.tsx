import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Gift } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { fmt } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/offers")({
  head: () => ({ meta: [{ title: "Offers — Café SaaS" }, { name: "description", content: "Bundles and points-redeemable offers." }] }),
  component: OffersPage,
});

type ApiOffer = { id: string; title?: string; name?: string; discountPrice?: number; isActive?: boolean };

function OffersPage() {
  const { data, isError } = useQuery({ queryKey: ["offers"], queryFn: () => api.get<ApiOffer[]>("/offers"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Offers" subtitle={isError ? "Backend not reachable right now." : "Bundles and promotions."} actions={<Button>New offer</Button>} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={Gift} title="No offers yet" text="Create a bundle or a points-redeemable offer." /> : (
          <Table head={["Offer", "Price", "Status", ""]}>
            {rows.map((o) => (
              <tr key={o.id} className="hover:bg-muted/40">
                <Td className="font-medium">{o.title ?? o.name ?? "Offer"}</Td>
                <Td className="num">{o.discountPrice != null ? fmt(o.discountPrice) : "—"}</Td>
                <Td>{o.isActive === false ? <Badge tone="neutral">Inactive</Badge> : <Badge tone="success">Active</Badge>}</Td>
                <Td><Button size="sm" variant="outline">Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
