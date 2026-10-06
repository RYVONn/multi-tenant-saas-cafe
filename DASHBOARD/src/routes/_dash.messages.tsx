import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { MessageSquare } from "lucide-react";
import { Avatar, Card, EmptyState, PageHeader } from "@/components/ui-kit";
import { api } from "@/lib/api-client";

export const Route = createFileRoute("/_dash/messages")({
  head: () => ({ meta: [{ title: "Messages — Café SaaS" }, { name: "description", content: "Conversations with staff and customers." }] }),
  component: MessagesPage,
});

type ApiConversation = { id: string; name?: string; lastMessage?: string; updatedAt?: string };

function MessagesPage() {
  const { data, isError } = useQuery({ queryKey: ["chat", "conversations"], queryFn: () => api.get<ApiConversation[]>("/chat/conversations"), retry: 1 });
  const rows = data ?? [];

  return (
    <>
      <PageHeader title="Messages" subtitle={isError ? "Sign in to view your conversations." : "Conversations with staff and customers."} />
      <Card>
        {rows.length === 0 ? <EmptyState icon={MessageSquare} title="No conversations yet" text="Messages from staff and customers will show up here." /> : (
          <div className="divide-y">
            {rows.map((c) => (
              <div key={c.id} className="flex items-center gap-3 p-4 hover:bg-muted/40">
                <Avatar name={c.name ?? "Chat"} />
                <div className="min-w-0 flex-1">
                  <div className="font-medium">{c.name ?? "Conversation"}</div>
                  <div className="truncate text-sm text-muted-foreground">{c.lastMessage ?? "No messages yet"}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
