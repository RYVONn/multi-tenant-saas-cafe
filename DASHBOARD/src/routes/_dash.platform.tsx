import { createFileRoute } from "@tanstack/react-router";
import { Building2 } from "lucide-react";
import { Card, EmptyState, PageHeader } from "@/components/ui-kit";

// Platform console for platform_admin users (cross-business oversight). No
// multi-tenant backend exists yet (the BACKEND is still single-tenant), so
// this is a placeholder until that work lands.
export const Route = createFileRoute("/_dash/platform")({
  head: () => ({ meta: [{ title: "Platform Console — Café SaaS" }, { name: "description", content: "Cross-business platform administration." }] }),
  component: PlatformPage,
});

function PlatformPage() {
  return (
    <>
      <PageHeader title="Platform Console" subtitle="Cross-business administration." />
      <Card>
        <EmptyState icon={Building2} title="Multi-tenant platform tools coming soon" text="This console will manage businesses once the backend's multi-tenancy work lands." />
      </Card>
    </>
  );
}
