import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { AlertTriangle, Boxes, CalendarClock, CalendarX, FileClock, History, PackageX, PackagePlus, Search, SlidersHorizontal, Tags, Trash2, Wallet } from "lucide-react";
import { Badge, Button, Card, EmptyState, Input, Kpi, PageHeader, Select, Table, Tabs, TabsContent, TabsList, Td } from "@/components/ui-kit";
import { draftPurchases, fmt, invCategories, inventory, TODAY, type InvItem } from "@/lib/mock-data";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_dash/inventory")({
  head: () => ({ meta: [{ title: "Inventory — Café SaaS" }, { name: "description", content: "Stock levels, expiry and purchases." }, { property: "og:title", content: "Inventory — Café SaaS" }, { property: "og:description", content: "Stock levels, expiry and purchases." }] }),
  component: InventoryPage,
});

const days = (d: string) => Math.round((new Date(d).getTime() - new Date(TODAY).getTime()) / 86400000);
export const stockState = (i: InvItem) => (i.qty <= 0 ? "out" : i.qty <= i.min ? "low" : "in");
const expState = (i: InvItem) => (!i.expiry ? "none" : days(i.expiry) < 0 ? "expired" : days(i.expiry) <= 7 ? "soon" : "ok");

type Filter = "all" | "low" | "out" | "soon" | "expired" | null;

function InventoryPage() {
  const [filter, setFilter] = useState<Filter>(null);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [tab, setTab] = useState("items");
  const value = inventory.reduce((s, i) => s + i.qty * i.cost, 0);
  const count = (f: (i: InvItem) => boolean) => inventory.filter(f).length;
  const pick = (f: Filter) => { setFilter((cur) => (cur === f ? null : f)); setTab("items"); };

  const rows = useMemo(() => inventory.filter((i) => {
    if (filter === "low" && stockState(i) !== "low") return false;
    if (filter === "out" && stockState(i) !== "out") return false;
    if (filter === "soon" && expState(i) !== "soon") return false;
    if (filter === "expired" && expState(i) !== "expired") return false;
    if (cat && i.category !== cat) return false;
    return (i.name + i.sku).toLowerCase().includes(q.toLowerCase());
  }), [filter, q, cat]);

  return (
    <>
      <PageHeader title="Inventory" subtitle="Track stock, expiry and purchasing across your kitchen." actions={<><Button variant="outline"><PackagePlus className="h-4 w-4" />Receive stock</Button><Button>New item</Button></>} />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Kpi label="Total Items" value={inventory.length} icon={Boxes} active={filter === "all"} onClick={() => pick("all")} />
        <Kpi label="Low Stock" value={count((i) => stockState(i) === "low")} icon={AlertTriangle} tone="warning" active={filter === "low"} onClick={() => pick("low")} />
        <Kpi label="Out of Stock" value={count((i) => stockState(i) === "out")} icon={PackageX} tone="destructive" active={filter === "out"} onClick={() => pick("out")} />
        <Kpi label="Expiring Soon" value={count((i) => expState(i) === "soon")} icon={CalendarClock} tone="warning" active={filter === "soon"} onClick={() => pick("soon")} />
        <Kpi label="Expired" value={count((i) => expState(i) === "expired")} icon={CalendarX} tone="destructive" active={filter === "expired"} onClick={() => pick("expired")} />
        <Kpi label="Stock Value" value={fmt(Math.round(value))} icon={Wallet} tone="success" />
        <Kpi label="Categories" value={Object.keys(invCategories).length} icon={Tags} tone="pink" />
        <Kpi label="Draft Purchases" value={draftPurchases} icon={FileClock} onClick={() => setTab("purchases")} />
      </div>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList items={[{ value: "items", label: "Items" }, { value: "purchases", label: "Purchases" }, { value: "analytics", label: "Analytics" }]} />
        <TabsContent value="items">
          <Card>
            <div className="flex flex-wrap items-center gap-2 border-b p-4">
              <div className="relative min-w-56 flex-1"><Search className="absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><Input className="ps-9" placeholder="Search name or SKU" value={q} onChange={(e) => setQ(e.target.value)} /></div>
              <Select value={cat} onChange={(e) => setCat(e.target.value)}><option value="">All categories</option>{Object.keys(invCategories).map((c) => <option key={c}>{c}</option>)}</Select>
              {filter && filter !== "all" && <Button variant="ghost" size="sm" onClick={() => setFilter(null)}>Clear filter</Button>}
            </div>
            {rows.length === 0 ? <EmptyState icon={Boxes} title="No items match" text="Try another filter or search term." /> : (
              <Table head={["Item", "SKU", "Category", "Type", "Qty", "Purchase unit", "Cost / unit", "Stock value", "Status", "Expiry", ""]}>
                {rows.map((i) => {
                  const st = stockState(i), ex = expState(i);
                  return (
                    <tr key={i.id} className={cn("transition hover:bg-muted/40", st === "out" && "bg-destructive-soft", st === "low" && "bg-warning-soft")}>
                      <Td className="font-medium">{i.name}</Td>
                      <Td className="num text-muted-foreground">{i.sku}</Td>
                      <Td><span className="inline-flex items-center gap-1.5 rounded-full border bg-card px-2 py-0.5 text-xs"><span className="h-2 w-2 rounded-full" style={{ background: invCategories[i.category] }} />{i.category}</span></Td>
                      <Td className="capitalize text-muted-foreground">{i.type}</Td>
                      <Td className="num font-medium">{i.qty} {i.unit}</Td>
                      <Td className="text-muted-foreground">{i.purchaseUnit}</Td>
                      <Td className="num">{fmt(i.cost)}</Td>
                      <Td className="num">{fmt(Math.round(i.qty * i.cost))}</Td>
                      <Td>{st === "out" ? <Badge tone="destructive">Out</Badge> : st === "low" ? <Badge tone="warning">Low</Badge> : <Badge tone="success">In stock</Badge>}</Td>
                      <Td>{ex === "none" ? <span className="text-muted-foreground">—</span> : ex === "expired" ? <Badge tone="destructive">Expired</Badge> : ex === "soon" ? <Badge tone="warning">{days(i.expiry!)}d left</Badge> : <span className="num text-xs text-muted-foreground">{i.expiry}</span>}</Td>
                      <Td>
                        <div className="flex gap-1">
                          <Button size="sm" variant="outline">Receive</Button>
                          <Button size="icon" variant="ghost" title="Adjust"><SlidersHorizontal className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" title="History"><History className="h-3.5 w-3.5" /></Button>
                          <Button size="icon" variant="ghost" title="Delete" className="hover:text-destructive"><Trash2 className="h-3.5 w-3.5" /></Button>
                        </div>
                      </Td>
                    </tr>
                  );
                })}
              </Table>
            )}
          </Card>
        </TabsContent>
        <TabsContent value="purchases"><Card><EmptyState icon={FileClock} title="Purchases coming in the next pass" text={`${draftPurchases} draft purchases are waiting. Invoice list and monthly templates will live here.`} /></Card></TabsContent>
        <TabsContent value="analytics"><Card><EmptyState icon={Wallet} title="Analytics coming in the next pass" text="Consumption, supplier spend and stock movement breakdowns." /></Card></TabsContent>
      </Tabs>
    </>
  );
}
