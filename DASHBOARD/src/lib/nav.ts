import { BarChart3, Boxes, Building2, CalendarDays, ClipboardList, Clock, Coffee, Gift, History, LayoutDashboard, MessageSquare, Package, Receipt, Settings, ShieldCheck, ShoppingBag, Store, Tags, Trash2, Truck, UserCog, Users, Wallet, type LucideIcon } from "lucide-react";
import { inventory } from "./mock-data";
import type { Role } from "./mock-data";

export const lowStockCount = inventory.filter((i) => i.qty <= i.min).length;
export const unreadMessages = 3;

type Item = { key: string; to: string; icon: LucideIcon; badge?: number };
const all: Record<string, Item> = {
  overview: { key: "overview", to: "/overview", icon: LayoutDashboard },
  orders: { key: "orders", to: "/orders", icon: ShoppingBag },
  orderHistory: { key: "orderHistory", to: "/order-history", icon: History },
  products: { key: "products", to: "/products", icon: Coffee },
  categories: { key: "categories", to: "/categories", icon: Tags },
  offers: { key: "offers", to: "/offers", icon: Gift },
  loyalty: { key: "loyalty", to: "/loyalty", icon: Wallet },
  customers: { key: "customers", to: "/customers", icon: Users },
  messages: { key: "messages", to: "/messages", icon: MessageSquare, badge: unreadMessages },
  staff: { key: "staff", to: "/staff", icon: UserCog },
  shifts: { key: "shifts", to: "/shifts", icon: Clock },
  shiftHistory: { key: "shiftHistory", to: "/shift-history", icon: ClipboardList },
  storefront: { key: "storefront", to: "/storefront", icon: Store },
  inventory: { key: "inventory", to: "/inventory", icon: Boxes, badge: lowStockCount },
  suppliers: { key: "suppliers", to: "/suppliers", icon: Truck },
  sales: { key: "sales", to: "/sales", icon: Receipt },
  reports: { key: "reports", to: "/reports", icon: BarChart3 },
  wasteLog: { key: "wasteLog", to: "/waste-log", icon: Trash2 },
  events: { key: "events", to: "/events", icon: CalendarDays },
  businessSettings: { key: "businessSettings", to: "/business-settings", icon: Settings },
  users: { key: "users", to: "/users", icon: ShieldCheck },
  admin: { key: "admin", to: "/admin", icon: Package },
  platform: { key: "platform", to: "/platform", icon: Building2 },
};

const ownerKeys = ["overview", "orders", "orderHistory", "products", "categories", "offers", "loyalty", "customers", "messages", "staff", "shifts", "shiftHistory", "storefront", "inventory", "suppliers", "sales", "reports", "wasteLog", "events", "businessSettings", "users", "admin"];
export const navByRole: Record<Role, Item[]> = {
  owner: ownerKeys.map((k) => all[k]!),
  manager: ownerKeys.map((k) => all[k]!),
  staff: ["orders", "orderHistory", "shifts", "messages", "shiftHistory"].map((k) => all[k]!),
  inventory_manager: ["inventory", "suppliers", "sales", "reports", "wasteLog", "shiftHistory", "messages"].map((k) => all[k]!),
  platform_admin: [all["platform"]!],
};
export const homeFor = (r: Role) => navByRole[r][0]!.to;
