// Seeded mock data for one business. Replace with real API calls later.
export type Role = "owner" | "manager" | "staff" | "inventory_manager" | "platform_admin";

export const business = { id: "biz_1", name: "Bleus Coffee House", slug: "bleus", initials: "BC", timezone: "Africa/Cairo", phone: "+20 100 555 0101", email: "hello@bleus.cafe" };

export const demoUsers: { id: string; name: string; email: string; role: Role; businessId: string | null }[] = [
  { id: "u1", name: "Omar Haddad", email: "owner@bleus.cafe", role: "owner", businessId: "biz_1" },
  { id: "u2", name: "Lina Farouk", email: "manager@bleus.cafe", role: "manager", businessId: "biz_1" },
  { id: "u3", name: "Karim Nabil", email: "staff@bleus.cafe", role: "staff", businessId: "biz_1" },
  { id: "u4", name: "Sara Adel", email: "inventory@bleus.cafe", role: "inventory_manager", businessId: "biz_1" },
  { id: "u5", name: "Platform Ops", email: "admin@platform.io", role: "platform_admin", businessId: null },
];

export const products = [
  { id: "p1", name: "Spanish Latte", category: "Coffee", price: 85 },
  { id: "p2", name: "Flat White", category: "Coffee", price: 75 },
  { id: "p3", name: "Iced Americano", category: "Coffee", price: 60 },
  { id: "p4", name: "Pistachio Croissant", category: "Bakery", price: 70 },
  { id: "p5", name: "Butter Croissant", category: "Bakery", price: 45 },
  { id: "p6", name: "Matcha Latte", category: "Tea", price: 90 },
  { id: "p7", name: "Chai Latte", category: "Tea", price: 70 },
  { id: "p8", name: "Club Sandwich", category: "Food", price: 140 },
  { id: "p9", name: "Avocado Toast", category: "Food", price: 120 },
  { id: "p10", name: "Cheesecake Slice", category: "Dessert", price: 95 },
  { id: "p11", name: "Fresh Orange Juice", category: "Drinks", price: 55 },
  { id: "p12", name: "Cold Brew 1L", category: "Coffee", price: 180 },
];

export type OrderStatus = "new" | "accepted" | "preparing" | "ready" | "out" | "completed" | "cancelled";
export type OrderType = "pickup" | "delivery" | "drive-thru";
export type Order = { id: string; number: number; customer: string; type: OrderType; status: OrderStatus; items: { name: string; qty: number }[]; total: number; minutesAgo: number };

const names = ["Mona S.", "Youssef K.", "Hana M.", "Ali R.", "Nour E.", "Tarek B.", "Dina F.", "Ziad H.", "Reem A.", "Fady G.", "Laila O.", "Samir T."];
const statuses: OrderStatus[] = ["new", "new", "accepted", "preparing", "preparing", "ready", "out", "completed", "completed", "cancelled", "new", "accepted", "ready", "completed"];
const types: OrderType[] = ["pickup", "delivery", "drive-thru"];
export const orders: Order[] = statuses.map((s, i) => {
  const a = products[i % products.length]!, b = products[(i * 3 + 2) % products.length]!;
  const qa = (i % 2) + 1;
  return { id: `o${i}`, number: 1040 + i, customer: names[i % names.length]!, type: types[i % 3]!, status: s, items: [{ name: a.name, qty: qa }, { name: b.name, qty: 1 }], total: a.price * qa + b.price, minutesAgo: 3 + i * 4 };
});

export const customers = names.slice(0, 8).map((n, i) => ({ id: `c${i}`, name: n.replace(".", "") + (i % 2 ? "ahmoud" : "aleh"), phone: `+20 10${i} 22${i} 4${i}0${i}`, orders: 4 + i * 3, spent: 620 + i * 410, lastOrder: `2026-10-0${(i % 4) + 1}` }));

export type Payment = { date: string; amount: number; method: string };
export type Sale = { id: string; invoice: string; customerId: string; date: string; items: { productId: string; name: string; qty: number; price: number }[]; method: string; status: "paid" | "partial" | "unpaid"; payments: Payment[] };
export const sales: Sale[] = Array.from({ length: 23 }, (_, i) => {
  const items = [products[i % 12]!, products[(i + 5) % 12]!].map((p, j) => ({ productId: p.id, name: p.name, qty: j + 1 + (i % 3), price: p.price }));
  const total = items.reduce((s, x) => s + x.qty * x.price, 0);
  const status = (["paid", "paid", "partial", "unpaid"] as const)[i % 4]!;
  const day = String(28 - i).padStart(2, "0");
  const date = i < 5 ? `2026-10-0${5 - i}` : `2026-09-${day}`;
  const payments = status === "paid" ? [{ date, amount: total, method: "Cash" }] : status === "partial" ? [{ date, amount: Math.round(total / 2), method: "Card" }] : [];
  return { id: `s${i}`, invoice: `INV-${2300 + i}`, customerId: `c${i % 8}`, date, items, method: i % 2 ? "Card" : "Cash", status, payments };
});
export const saleTotal = (s: Sale) => s.items.reduce((a, x) => a + x.qty * x.price, 0);
export const salePaid = (s: Sale) => s.payments.reduce((a, x) => a + x.amount, 0);

export const invCategories: Record<string, string> = { Dairy: "hsl(200 70% 45%)", Coffee: "hsl(25 50% 35%)", Bakery: "hsl(38 92% 50%)", Produce: "hsl(152 60% 36%)", Packaging: "hsl(219 20% 55%)", Syrups: "hsl(335 61% 63%)" };
export type InvItem = { id: string; name: string; sku: string; category: string; type: "raw" | "packaged"; qty: number; unit: string; purchaseUnit: string; cost: number; min: number; expiry: string | null };
export const inventory: InvItem[] = [
  { id: "i1", name: "Whole Milk", sku: "DRY-001", category: "Dairy", type: "raw", qty: 4, unit: "L", purchaseUnit: "Crate (12L)", cost: 32, min: 12, expiry: "2026-10-08" },
  { id: "i2", name: "Espresso Beans — House", sku: "COF-001", category: "Coffee", type: "raw", qty: 18.5, unit: "kg", purchaseUnit: "Bag (5kg)", cost: 640, min: 6, expiry: "2027-02-01" },
  { id: "i3", name: "Oat Milk", sku: "DRY-004", category: "Dairy", type: "packaged", qty: 0, unit: "L", purchaseUnit: "Case (6L)", cost: 85, min: 6, expiry: null },
  { id: "i4", name: "Croissant Dough", sku: "BAK-002", category: "Bakery", type: "raw", qty: 40, unit: "pc", purchaseUnit: "Box (40)", cost: 14, min: 30, expiry: "2026-10-04" },
  { id: "i5", name: "Avocado", sku: "PRD-003", category: "Produce", type: "raw", qty: 9, unit: "pc", purchaseUnit: "Box (24)", cost: 22, min: 10, expiry: "2026-10-07" },
  { id: "i6", name: "12oz Cups", sku: "PKG-012", category: "Packaging", type: "packaged", qty: 850, unit: "pc", purchaseUnit: "Sleeve (50)", cost: 1.8, min: 300, expiry: null },
  { id: "i7", name: "Vanilla Syrup", sku: "SYR-001", category: "Syrups", type: "packaged", qty: 3, unit: "btl", purchaseUnit: "Bottle", cost: 260, min: 2, expiry: "2027-05-10" },
  { id: "i8", name: "Pistachio Paste", sku: "BAK-007", category: "Bakery", type: "raw", qty: 0, unit: "kg", purchaseUnit: "Tub (1kg)", cost: 950, min: 1, expiry: null },
  { id: "i9", name: "Cream Cheese", sku: "DRY-006", category: "Dairy", type: "raw", qty: 5, unit: "kg", purchaseUnit: "Block (2.5kg)", cost: 180, min: 3, expiry: "2026-09-30" },
  { id: "i10", name: "Oranges", sku: "PRD-001", category: "Produce", type: "raw", qty: 28, unit: "kg", purchaseUnit: "Crate (10kg)", cost: 18, min: 15, expiry: "2026-10-12" },
  { id: "i11", name: "Caramel Syrup", sku: "SYR-002", category: "Syrups", type: "packaged", qty: 1, unit: "btl", purchaseUnit: "Bottle", cost: 260, min: 2, expiry: "2027-03-01" },
  { id: "i12", name: "Paper Bags", sku: "PKG-020", category: "Packaging", type: "packaged", qty: 420, unit: "pc", purchaseUnit: "Pack (100)", cost: 1.2, min: 200, expiry: null },
];
export const draftPurchases = 2;

export const staff = [
  { id: "u1", name: "Omar Haddad", role: "Owner" },
  { id: "u2", name: "Lina Farouk", role: "Manager" },
  { id: "u3", name: "Karim Nabil", role: "Barista" },
  { id: "u6", name: "Mariam Zaki", role: "Cashier" },
  { id: "u7", name: "Hossam Wael", role: "Barista" },
];

export type Shift = { id: string; staffId: string; date: string; clockIn: string; clockOut: string | null; opening: number; expected: number; closing: number | null; channels: { pickup: number; delivery: number; drive: number }; revenue: number; status: "working" | "completed"; varianceReason?: string | undefined; handover?: { prev: string; next: string; at: string; ackPrev: boolean; ackNext: boolean } };
export const shifts: Shift[] = Array.from({ length: 14 }, (_, i) => {
  const ch = { pickup: 12 + (i * 7) % 15, delivery: 8 + (i * 5) % 11, drive: 3 + (i * 3) % 7 };
  const revenue = (ch.pickup + ch.delivery + ch.drive) * 92 + i * 37;
  const expected = 500 + Math.round(revenue * 0.45);
  const variance = i % 4 === 1 ? -40 : i % 5 === 3 ? 25 : 0;
  const day = String(5 - Math.floor(i / 2)).padStart(2, "0");
  const date = Number(day) > 0 ? `2026-10-${day}` : `2026-09-${30 + Number(day)}`;
  const s = staff[(i % 4) + 1]!;
  return {
    id: `sh${i}`, staffId: s.id, date, clockIn: i % 2 ? "15:00" : "07:00", clockOut: i === 0 ? null : i % 2 ? "23:00" : "15:00",
    opening: 500, expected, closing: i === 0 ? null : expected + variance, channels: ch, revenue, status: i === 0 ? "working" : "completed",
    varianceReason: variance ? (variance < 0 ? "Change given incorrectly on a large note." : "Tip left in drawer.") : undefined,
    handover: i % 2 === 0 && i > 0 ? { prev: s.name, next: staff[((i + 1) % 4) + 1]!.name, at: `${date} 15:02`, ackPrev: true, ackNext: i % 4 !== 2 } : undefined,
  };
});

export const fmt = (n: number) => `EGP ${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
export const TODAY = "2026-10-05";
