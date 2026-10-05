import i18n from "i18next";
import { initReactI18next } from "react-i18next";

const en = {
  nav: {
    overview: "Overview", orders: "Orders", orderHistory: "Order History", products: "Products",
    categories: "Categories", offers: "Offers", loyalty: "Loyalty", customers: "Customers",
    messages: "Messages", staff: "Staff", shifts: "Shifts", shiftHistory: "Shift History",
    storefront: "Storefront Settings", inventory: "Inventory", suppliers: "Suppliers", sales: "Sales",
    reports: "Reports", wasteLog: "Waste Log", events: "Events", businessSettings: "Business Settings",
    users: "Users & Roles", admin: "Admin Panel", platform: "Platform Admin",
  },
  common: { logout: "Log out", search: "Search…", signIn: "Sign in" },
};

if (!i18n.isInitialized) {
  i18n.use(initReactI18next).init({
    resources: { en: { translation: en }, ar: { translation: en } },
    lng: "en",
    fallbackLng: "en",
    interpolation: { escapeValue: false },
  });
}

export default i18n;
