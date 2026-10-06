import { createFileRoute } from "@tanstack/react-router";
import { Avatar, Badge, Button, Card, PageHeader, Table, Td } from "@/components/ui-kit";
import { demoUsers } from "@/lib/mock-data";
import { roleLabel } from "@/lib/auth";

// Users & Roles management has no dedicated backend endpoint yet — runs on
// the same sample accounts the mock auth provider uses.
export const Route = createFileRoute("/_dash/users")({
  head: () => ({ meta: [{ title: "Users & Roles — Café SaaS" }, { name: "description", content: "Who has access to this dashboard, and their role." }] }),
  component: UsersPage,
});

function UsersPage() {
  return (
    <>
      <PageHeader title="Users & Roles" subtitle="Who has access to this dashboard." actions={<Button>Invite user</Button>} />
      <Card>
        <Table head={["Name", "Email", "Role", ""]}>
          {demoUsers.filter((u) => u.role !== "platform_admin").map((u) => (
            <tr key={u.id} className="hover:bg-muted/40">
              <Td><div className="flex items-center gap-2"><Avatar name={u.name} />{u.name}</div></Td>
              <Td className="text-muted-foreground">{u.email}</Td>
              <Td><Badge tone="primary">{roleLabel[u.role]}</Badge></Td>
              <Td><Button size="sm" variant="outline">Manage</Button></Td>
            </tr>
          ))}
        </Table>
      </Card>
    </>
  );
}
