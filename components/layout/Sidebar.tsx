"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BarChart3,
  Home,
  MessageSquare,
  PanelLeftClose,
  Settings,
  Shield,
  Star,
  Trophy,
  UserRound,
  Users,
  X,
} from "lucide-react";
import {
  GUEST_NAV_ITEMS,
  PRIMARY_NAV_ITEMS,
  SIDEBAR_MY_AREA_ITEMS,
  SIDEBAR_UTILITY_ITEMS,
  getVisibleItems,
} from "@/components/layout/navConfig";
import type { AuthState, NavItem } from "@/components/layout/types";

type SidebarProps = {
  auth: AuthState;
  mobileOpen: boolean;
  onMobileClose: () => void;
  desktopCollapsed: boolean;
};

function isActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

function NavIcon({ item }: { item: NavItem }) {
  if (item.iconUrl) {
    return (
      <img
        src={item.iconUrl}
        alt={`${item.label} crest`}
        className="h-5 w-5 rounded-full object-contain"
      />
    );
  }

  const { label } = item;
  if (label === "Home") return <Home className="h-4 w-4" />;
  if (label === "Matches") return <Trophy className="h-4 w-4" />;
  if (label === "Teams") return <Shield className="h-4 w-4" />;
  if (label === "Communities") return <Users className="h-4 w-4" />;
  if (label === "People") return <UserRound className="h-4 w-4" />;
  if (label === "Discussions") return <MessageSquare className="h-4 w-4" />;
  if (label === "Standings") return <BarChart3 className="h-4 w-4" />;
  if (label === "My Team") return <Star className="h-4 w-4" />;
  if (label === "Settings") return <Settings className="h-4 w-4" />;
  return <PanelLeftClose className="h-4 w-4" />;
}

function SidebarLink({
  item,
  active,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  onNavigate?: () => void;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      className={`group relative block h-10 rounded-lg px-3 text-sm font-semibold transition ${
        active
          ? "bg-[color:var(--nav-active-bg)] text-[color:var(--nav-active-text)]"
          : "text-[color:var(--nav-muted)] hover:bg-[color:var(--nav-hover)] hover:text-[color:var(--nav-text)]"
      }`}
    >
      <span
        className={`absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-r ${
          active ? "bg-[color:var(--nav-active-rail)]" : "bg-transparent group-hover:bg-[color:var(--nav-hover-rail)]"
        }`}
      />
      <span className="inline-flex h-full items-center gap-2.5">
        <span className={`${active ? "text-[color:var(--nav-active-text)]" : "text-[color:var(--nav-muted)] group-hover:text-[color:var(--nav-text)]"}`}>
          <NavIcon item={item} />
        </span>
        <span className="truncate" title={item.label}>{item.label}</span>
      </span>
    </Link>
  );
}

function SidebarContent({
  auth,
  pathname,
  onNavigate,
  showGuestAuthActions = false,
}: {
  auth: AuthState;
  pathname: string;
  onNavigate?: () => void;
  showGuestAuthActions?: boolean;
}) {
  const mainItems = getVisibleItems(PRIMARY_NAV_ITEMS, auth);
  const guestAuthItems = showGuestAuthActions ? getVisibleItems(GUEST_NAV_ITEMS, auth) : [];
  const myAreaItems = getVisibleItems(SIDEBAR_MY_AREA_ITEMS, auth)
    .filter((item) => {
      if (item.href !== "/my-team") return true;
      return Boolean(auth.isAuthenticated && auth.favoriteTeamName && auth.favoriteTeamId);
    })
    .map((item) => {
      if (item.href !== "/my-team") return item;
      return {
        ...item,
        label: auth.favoriteTeamName as string,
        href: `/teams/${auth.favoriteTeamId}`,
        iconUrl: auth.favoriteTeamCrestUrl ?? null,
      };
    });
  const utilityItems = getVisibleItems(SIDEBAR_UTILITY_ITEMS, auth);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-1">
        <nav className="space-y-1">
          {mainItems.map((item) => (
            <SidebarLink
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              onNavigate={onNavigate}
            />
          ))}
        </nav>

        {myAreaItems.length > 0 && (
          <section className="mt-8 pt-2">
            <h2 className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--nav-muted)]">My Team</h2>
            <nav className="space-y-1">
              {myAreaItems.map((item) => (
                <SidebarLink
                  key={item.href}
                  item={item}
                  active={isActive(pathname, item.href)}
                  onNavigate={onNavigate}
                />
              ))}
            </nav>
          </section>
        )}

        {guestAuthItems.length > 0 && (
          <section className="mt-8 pt-2">
            <h2 className="px-3 pb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-[color:var(--nav-muted)]">
              Account
            </h2>
            <div className="space-y-2 px-3">
              {guestAuthItems.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  onClick={onNavigate}
                  className={`inline-flex h-10 w-full items-center justify-center rounded-lg px-3 text-sm font-semibold transition ${
                    item.label === "Login"
                      ? "bg-[color:var(--btn-primary-bg)] text-[color:var(--btn-primary-text)] hover:bg-[color:var(--btn-primary-hover)]"
                      : "border border-[color:var(--nav-border)] bg-[color:var(--nav-surface)] text-[color:var(--nav-text)] hover:bg-[color:var(--nav-hover)]"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          </section>
        )}

      </div>

      {utilityItems.length > 0 && (
        <section className="mt-auto border-t border-[color:var(--nav-border)] pt-3">
          <nav className="space-y-1">
            {utilityItems.map((item) => (
              <SidebarLink
                key={item.href}
                item={item}
                active={isActive(pathname, item.href)}
                onNavigate={onNavigate}
              />
            ))}
          </nav>
        </section>
      )}
    </div>
  );
}

export default function Sidebar({
  auth,
  mobileOpen,
  onMobileClose,
  desktopCollapsed,
}: SidebarProps) {
  const pathname = usePathname();

  return (
    <>
      <button
        type="button"
        aria-label="Close navigation menu"
        onClick={onMobileClose}
        className={`fixed inset-0 z-40 bg-[color:var(--nav-overlay)] transition-opacity lg:hidden ${
          mobileOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      <aside
        className={`fixed inset-y-0 left-0 z-50 w-[min(18rem,calc(100vw-1rem))] border-r border-[color:var(--nav-border)] bg-[color:var(--nav-bg)] px-4 pb-5 pt-4 shadow-[8px_0_28px_rgba(2,8,23,0.12)] backdrop-blur transition-transform duration-200 ease-out lg:hidden ${
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <div className="mb-4 flex items-center justify-between border-b border-[color:var(--nav-border)] pb-3">
          <Link href="/" onClick={onMobileClose} className="inline-flex items-center gap-2">
            <span className="brand-logo-stack h-5 w-5">
              <Image
                src="/branding/logo_icon_white.svg"
                alt="SportsDeck logo"
                width={20}
                height={18}
                className="brand-logo-dark h-5 w-auto"
              />
              <Image
                src="/branding/logo_icon_black.svg"
                alt="SportsDeck logo"
                width={20}
                height={18}
                className="brand-logo-light h-5 w-auto"
              />
            </span>
            <span className="text-base font-extrabold uppercase leading-none tracking-[0.01em]">
              <span className="text-[color:var(--nav-text)]">Sports</span>
              <span className="text-sky-300">Deck</span>
            </span>
          </Link>
          <button
            type="button"
            onClick={onMobileClose}
            aria-label="Close menu"
            className="inline-flex h-10 w-10 items-center justify-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)]/95 text-[color:var(--foreground)] shadow-[0_6px_16px_rgba(15,23,42,0.08)] transition hover:border-sky-400/45 hover:bg-[color:var(--surface-elevated)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400/35 [html[data-theme='dark']_&]:border-[color:var(--nav-border)] [html[data-theme='dark']_&]:bg-[color:var(--nav-surface)] [html[data-theme='dark']_&]:shadow-[0_8px_20px_rgba(0,0,0,0.24)] [html[data-theme='dark']_&]:hover:bg-[color:var(--nav-hover)]"
          >
            <X className="h-6 w-6" strokeWidth={2.5} />
          </button>
        </div>
        <div className="h-[calc(100%-4rem)] overflow-y-auto pr-1">
          <SidebarContent
            auth={auth}
            pathname={pathname}
            onNavigate={onMobileClose}
            showGuestAuthActions
          />
        </div>
      </aside>

      <aside
        className={`hidden border-r border-[color:var(--nav-border)] bg-[color:var(--nav-bg)] p-5 lg:fixed lg:left-0 lg:top-16 lg:z-30 lg:block lg:h-[calc(100vh-4rem)] lg:w-64 lg:transition-transform lg:duration-200 lg:ease-out ${
          desktopCollapsed
            ? "lg:pointer-events-none lg:-translate-x-full lg:opacity-0"
            : "lg:translate-x-0 lg:opacity-100"
        }`}
        aria-hidden={desktopCollapsed}
      >
        <SidebarContent auth={auth} pathname={pathname} />
      </aside>
    </>
  );
}
