import type { AuthState, NavItem, UserAction, UserMenuItem } from "@/components/layout/types";

export const PRIMARY_NAV_ITEMS: NavItem[] = [
  { label: "Home", href: "/" },
  { label: "Matches", href: "/matches" },
  { label: "Teams", href: "/teams" },
  { label: "Communities", href: "/communities" },
  { label: "People", href: "/people" },
  { label: "Discussions", href: "/discussions" },
  { label: "Standings", href: "/standings" },
];

export const SIDEBAR_MY_AREA_ITEMS: NavItem[] = [
  { label: "My Team", href: "/my-team", requiresAuth: true },
];

export const SIDEBAR_UTILITY_ITEMS: NavItem[] = [
  { label: "Settings", href: "/settings" },
];

export const TOP_NAV_NOTIFICATION_ITEM: NavItem = {
  label: "Notifications",
  href: "/notifications",
  requiresAuth: true,
};

export const GUEST_NAV_ITEMS: NavItem[] = [
  { label: "Login", href: "/login", hideWhenAuth: true },
  { label: "Register", href: "/register", hideWhenAuth: true },
];

export const USER_MENU_LINKS: UserMenuItem[] = [
  { label: "Profile", href: "/profile" },
  { label: "Settings", href: "/settings?tab=profile" },
];

export const USER_MENU_ACTIONS: UserAction[] = [
  { type: "logout", label: "Logout" },
];

export function getVisibleItems(items: NavItem[], auth: AuthState): NavItem[] {
  return items.filter((item) => {
    if (item.requiresAuth && !auth.isAuthenticated) return false;
    if (item.hideWhenAuth && auth.isAuthenticated) return false;
    return true;
  });
}
