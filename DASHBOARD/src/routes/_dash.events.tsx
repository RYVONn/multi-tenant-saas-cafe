import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CalendarDays } from "lucide-react";
import { Badge, Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/events")({
  head: () => ({ meta: [{ title: "Events — Café SaaS" }, { name: "description", content: "In-store events and promotions." }] }),
  component: EventsPage,
});

type ApiEvent = { id: string; title?: string; startsAt?: string; isActive?: boolean };

function EventsPage() {
  const { data, isError } = useQuery({ queryKey: ["events", "all"], queryFn: () => api.get<ApiEvent[]>("/events/all"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Events" subtitle={isError ? "Sign in to manage events." : "In-store events and promotions."} actions={<Button>New event</Button>} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={CalendarDays} title="No events yet" text="Create an event to promote it to customers." /> : (
          <Table head={["Title", "Date", "Status", ""]}>
            {rows.map((e) => (
              <tr key={e.id} className="hover:bg-muted/40">
                <Td className="font-medium">{e.title ?? "Event"}</Td>
                <Td className="num text-muted-foreground">{e.startsAt ? new Date(e.startsAt).toLocaleDateString() : "—"}</Td>
                <Td>{e.isActive === false ? <Badge tone="neutral">Inactive</Badge> : <Badge tone="success">Active</Badge>}</Td>
                <Td><Button size="sm" variant="outline">Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
