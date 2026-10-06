import { createFileRoute } from "@tanstack/react-router";
import { Button, Avatar, Badge, Card, PageHeader, Table, Td } from "@/components/ui-kit";
import { staff } from "@/lib/mock-data";

// No dedicated staff-roster endpoint exists yet (staff live implicitly as
// shift/order actors). Runs on sample data until a real endpoint ships.
export const Route = createFileRoute("/_dash/staff")({
  head: () => ({ meta: [{ title: "Staff — Café SaaS" }, { name: "description", content: "Your team members and roles." }] }),
  component: StaffPage,
});

function StaffPage() {
  return (
    <>
      <PageHeader title="Staff" subtitle="Your team members and roles." actions={<Button>Invite staff</Button>} />
      <Card>
        <Table head={["Name", "Role", "Status", ""]}>
          {staff.map((s) => (
            <tr key={s.id} className="hover:bg-muted/40">
              <Td><div className="flex items-center gap-2"><Avatar name={s.name} />{s.name}</div></Td>
              <Td className="text-muted-foreground">{s.role}</Td>
              <Td><Badge tone="success">Active</Badge></Td>
              <Td><Button size="sm" variant="outline">Manage</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
