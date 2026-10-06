import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { Tags } from "lucide-react";
import { Button, Card, EmptyState, PageHeader, Table, Td } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/categories")({
  head: () => ({ meta: [{ title: "Categories — Café SaaS" }, { name: "description", content: "Group your menu items into categories." }] }),
  component: CategoriesPage,
});

type ApiCategory = { id: string; name: string; productsCount?: number };

function CategoriesPage() {
  const { data, isError } = useQuery({ queryKey: ["categories"], queryFn: () => api.get<ApiCategory[]>("/categories"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Categories" subtitle={isError ? "Backend not reachable right now." : "Menu categories."} actions={<Button>New category</Button>} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={Tags} title="No categories yet" text="Create a category to organize your menu." /> : (
          <Table head={["Name", "Products", ""]}>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-muted/40">
                <Td className="font-medium">{c.name}</Td>
                <Td className="num text-muted-foreground">{c.productsCount ?? "—"}</Td>
                <Td><Button size="sm" variant="outline">Edit</Button></Td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
