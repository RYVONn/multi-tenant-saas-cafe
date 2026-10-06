import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3 } from "lucide-react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Card, EmptyState, Input, Label, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/reports")({
  head: () => ({ meta: [{ title: "Reports — Café SaaS" }, { name: "description", content: "Consumption and spend analytics." }] }),
  component: ReportsPage,
});

type Analytics = { byItem?: { name: string; total: number }[] } | { name: string; total: number }[];

function ReportsPage() {
  const [from, setFrom] = useState("2026-09-01");
  const [to, setTo] = useState("2026-10-05");
  const { data, isError } = useQuery({
    queryKey: ["inventory", "analytics", from, to],
    queryFn: () => api.get<Analytics>("/inventory/analytics", { from, to }),
    retry: 1,
  });
  const chartData = Array.isArray(data) ? data : data?.byItem ?? [];

  return (
    <>
      <PageHeader title="Reports" subtitle="Consumption and spend over a date range." actions={<div className="flex items-end gap-2"><div><Label>From</Label><Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></div><div><Label>To</Label><Input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></div></div>} />
      <Card className="p-4">
        {isError || chartData.length === 0 ? (
          <EmptyState icon={BarChart3} title={isError ? "Backend not reachable" : "No data for this range"} text="Analytics will appear once inventory consumption is recorded." />
        ) : (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="total" radius={[6, 6, 0, 0]} fill="hsl(var(--primary))" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </Card>
    </>
  );
}
