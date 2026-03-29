export type AuthState = {
  isAuthenticated: boolean;
  username?: string | null;
  avatar?: string | null;
  notificationsCount?: number;
  accountStatus?: "ACTIVE" | "SUSPENDED" | "BANNED" | null;
  accountStatusReason?: string | null;
  suspendedUntil?: string | null;
  accountRestoredNoticePending?: boolean;
  favoriteTeamId?: number | null;
  favoriteTeamName?: string | null;
  favoriteTeamCrestUrl?: string | null;
};

export type NavItem = {
  label: string;
  href: string;
  requiresAuth?: boolean;
  hideWhenAuth?: boolean;
  iconUrl?: string | null;
};

export type UserMenuItem = {
  label: string;
  href: string;
};

export type UserAction = {
  type: "logout";
  label: string;
};
