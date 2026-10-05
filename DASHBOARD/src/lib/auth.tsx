import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { demoUsers, type Role } from "./mock-data";

type User = (typeof demoUsers)[number];
type Ctx = { user: User | null; ready: boolean; login: (email: string) => boolean; logout: () => void; dir: "ltr" | "rtl"; toggleDir: () => void };
const AuthContext = createContext<Ctx | null>(null);
const KEY = "cafe-saas-user";

// Mock auth — swap login/logout for real API calls later.
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);
  const [dir, setDir] = useState<"ltr" | "rtl">("ltr");
  useEffect(() => {
    const id = localStorage.getItem(KEY);
    setUser(demoUsers.find((u) => u.id === id) ?? null);
    setReady(true);
  }, []);
  useEffect(() => { document.documentElement.dir = dir; }, [dir]);
  const login = (email: string) => {
    const u = demoUsers.find((x) => x.email.toLowerCase() === email.trim().toLowerCase());
    if (!u) return false;
    localStorage.setItem(KEY, u.id);
    setUser(u);
    return true;
  };
  const logout = () => { localStorage.removeItem(KEY); setUser(null); };
  return <AuthContext.Provider value={{ user, ready, login, logout, dir, toggleDir: () => setDir((d) => (d === "ltr" ? "rtl" : "ltr")) }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const c = useContext(AuthContext);
  if (!c) throw new Error("useAuth outside AuthProvider");
  return c;
}

export const roleLabel: Record<Role, string> = { owner: "Owner", manager: "Manager", staff: "Staff", inventory_manager: "Inventory Manager", platform_admin: "Platform Admin" };
