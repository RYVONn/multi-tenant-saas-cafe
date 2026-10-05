import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Coffee } from "lucide-react";
import { Button, Card, Input, Label } from "@/components/ui-kit";
import { useAuth, roleLabel } from "@/lib/auth";
import { demoUsers } from "@/lib/mock-data";
import { homeFor } from "@/lib/nav";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Sign in — Café SaaS Dashboard" },
      { name: "description", content: "Back-office dashboard for café and restaurant owners and staff." },
      { property: "og:title", content: "Sign in — Café SaaS Dashboard" },
      { property: "og:description", content: "Back-office dashboard for café and restaurant owners and staff." },
    ],
  }),
  component: Login,
});

function Login() {
  const { user, ready, login } = useAuth();
  const navigate = useNavigate();
  const [email, setEmail] = useState("owner@bleus.cafe");
  const [err, setErr] = useState("");
  useEffect(() => { if (ready && user) navigate({ to: homeFor(user.role) }); }, [ready, user, navigate]);

  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-primary p-12 text-primary-foreground lg:flex">
        <div className="absolute -end-24 -top-24 h-80 w-80 rounded-full bg-accent/30 blur-3xl" />
        <div className="absolute -bottom-32 -start-16 h-96 w-96 rounded-full bg-navy-mid blur-2xl" />
        <div className="relative flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-lg bg-accent text-accent-foreground"><Coffee className="h-5 w-5" /></span><span className="font-heading text-lg font-bold">Café SaaS</span></div>
        <div className="relative">
          <h1 className="max-w-md text-4xl leading-tight">Run every shift, order and invoice from one calm back office.</h1>
          <p className="mt-4 max-w-sm text-primary-foreground/70">Orders, inventory, sales and staff — built for cafés and restaurants.</p>
        </div>
        <div className="relative text-xs text-primary-foreground/50">© 2026 Café SaaS</div>
      </div>
      <div className="flex items-center justify-center p-6">
        <Card className="w-full max-w-md p-8">
          <h2 className="text-2xl text-secondary">Welcome back</h2>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to your business dashboard.</p>
          <form className="mt-6 space-y-4" onSubmit={(e) => { e.preventDefault(); if (!login(email)) setErr("No account found for this email."); }}>
            <div><Label>Email</Label><Input value={email} onChange={(e) => setEmail(e.target.value)} /></div>
            <div><Label>Password</Label><Input type="password" defaultValue="demo1234" /></div>
            {err && <p className="text-sm text-destructive">{err}</p>}
            <Button className="w-full" type="submit">Sign in</Button>
          </form>
          <div className="mt-6 border-t pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">Demo accounts</p>
            <div className="flex flex-wrap gap-2">
              {demoUsers.map((u) => (
                <button key={u.id} onClick={() => setEmail(u.email)} className="cursor-pointer rounded-full border px-3 py-1 text-xs transition hover:border-primary hover:text-primary">{roleLabel[u.role]}</button>
              ))}
            </div>
          </div>
        </Card>
      </div>
    </div>
  );
}
