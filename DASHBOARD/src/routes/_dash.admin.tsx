import { createFileRoute } from "@tanstack/react-router";
import { Package, ShieldCheck, Database, Server } from "lucide-react";
import { Card, Kpi, PageHeader } from "@/components/ui-kit";

// Admin Panel has no dedicated backend endpoint yet — this is a placeholder
// shell for business-level admin tools (data export, integrations, danger
// zone), styled to match the rest of the dashboard.
export const Route = createFileRoute("/_dash/admin")({
  head: () => ({ meta: [{ title: "Admin Panel — Café SaaS" }, { name: "description", content: "Advanced settings and tools for this business." }] }),
  component: AdminPage,
});

function AdminPage() {
  return (
    <>
      <PageHeader title="Admin Panel" subtitle="Advanced settings and tools for this business." />
      <div className="mb-6 grid gap-3 sm:grid-cols-3">
        <Kpi label="API Status" value="Online" icon={Server} tone="success" />
        <Kpi label="Integrations" value={0} icon={Package} />
        <Kpi label="Access Roles" value={5} icon={ShieldCheck} />
      </div>
      <Card className="p-6">
        <h2 className="mb-1 flex items-center gap-2 font-heading text-lg font-bold text-secondary"><Database className="h-4 w-4" />Data & integrations</h2>
        <p className="text-sm text-muted-foreground">Export your data, manage API keys and configure integrations here once these tools ship.</p>
      </Card>
    </>
  );
}
