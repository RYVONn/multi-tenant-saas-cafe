import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Store } from "lucide-react";
import { Button, Card, EmptyState, Input, Label, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api-client";
import { business } from "@/lib/mock-data";

export const Route = createFileRoute("/_dash/storefront")({
  head: () => ({ meta: [{ title: "Storefront Settings — Café SaaS" }, { name: "description", content: "How your business appears to customers." }] }),
  component: StorefrontPage,
});

type ApiStorefront = { name?: string; slug?: string; phone?: string; email?: string; bannerUrl?: string };

function StorefrontPage() {
  const { data, isError } = useQuery({ queryKey: ["storefront"], queryFn: () => api.get<ApiStorefront>("/storefront"), retry: 1 });
  const s = data ?? business;

  return (
    <>
      <PageHeader title="Storefront Settings" subtitle={isError ? "Showing sample data — backend not reachable." : "How your business appears to customers."} actions={<Button>Save changes</Button>} />
      <Card className="max-w-xl p-6">
        {!s ? <EmptyState icon={Store} title="No storefront configured" /> : (
          <div className="space-y-4">
            <div><Label>Business name</Label><Input defaultValue={s.name} /></div>
            <div><Label>Slug</Label><Input defaultValue={"slug" in s ? s.slug : undefined} /></div>
            <div><Label>Phone</Label><Input defaultValue={s.phone} /></div>
            <div><Label>Email</Label><Input defaultValue={s.email} /></div>
          </div>
        )}
      </Card>
    </>
  );
}
