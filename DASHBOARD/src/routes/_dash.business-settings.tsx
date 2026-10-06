import { createFileRoute } from "@tanstack/react-router";
import { Button, Card, Input, Label, PageHeader } from "@/components/ui-kit";
import { business } from "@/lib/mock-data";

// No generic "business settings" endpoint exists yet on the backend — the
// closest real data is /api/settings (feature flags) and /api/storefront
// (public-facing fields, see the Storefront Settings page). This page is a
// solid UI shell on sample data until a dedicated settings endpoint ships.
export const Route = createFileRoute("/_dash/business-settings")({
  head: () => ({ meta: [{ title: "Business Settings — Café SaaS" }, { name: "description", content: "Core details about your business." }] }),
  component: BusinessSettingsPage,
});

function BusinessSettingsPage() {
  return (
    <>
      <PageHeader title="Business Settings" subtitle="Core details about your business." actions={<Button>Save changes</Button>} />
      <Card className="max-w-xl p-6">
        <div className="space-y-4">
          <div><Label>Business name</Label><Input defaultValue={business.name} /></div>
          <div><Label>Timezone</Label><Input defaultValue={business.timezone} /></div>
          <div><Label>Phone</Label><Input defaultValue={business.phone} /></div>
          <div><Label>Email</Label><Input defaultValue={business.email} /></div>
        </div>
      </Card>
    </>
  );
}
