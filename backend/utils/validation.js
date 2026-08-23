// Pure validation/normalization helpers shared by the controllers.
// (Bodies copied verbatim from server.js.)
function normalizePagePath(rawPath) {
  if (!rawPath || typeof rawPath !== 'string') return '/';
  const [pathname] = rawPath.split('?');
  if (!pathname || pathname === '/') return '/';
  return pathname.startsWith('/') ? pathname : `/${pathname}`;
}

const ADMIN_EDIT_EXCLUDED_PAGES = new Set([
  '/dashboard.html',
  '/user-management.html',
  '/configuration.html',
  '/backup-restore.html',
  '/shop.html',
  '/shop-admin.html',
  '/finance-admin.html',
  '/float-admin.html',
  '/float-report.html',
  '/users-report.html',
  '/login.html',
  '/register.html',
]);

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;
const LENGTH_VALUE_PATTERN = /^(?:-?\d+(?:\.\d+)?(?:px|rem|em|%|vh|vw)|0)$/;
const BORDER_STYLE_VALUES = new Set(['none', 'solid', 'dashed', 'dotted', 'double']);

function isAdminEditablePagePath(pagePath) {
  return !ADMIN_EDIT_EXCLUDED_PAGES.has(pagePath);
}

function validateEditablePagePath(res, pagePath) {
  if (!isAdminEditablePagePath(pagePath)) {
    res.status(403).json({ error: 'Editing is disabled for this page' });
    return false;
  }
  return true;
}

function normalizeHexColor(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  if (!HEX_COLOR_PATTERN.test(normalized)) return null;
  return normalized.toLowerCase();
}

function normalizeLengthValue(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return LENGTH_VALUE_PATTERN.test(normalized) ? normalized : null;
}

function normalizeBorderStyle(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return null;
  return BORDER_STYLE_VALUES.has(normalized) ? normalized : null;
}

function normalizePositionMode(value) {
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  if (!normalized) return null;
  return ['flow', 'absolute'].includes(normalized) ? normalized : null;
}

function normalizeCoordinate(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(-10000, Math.min(10000, parsed));
  return Math.round(clamped);
}

function normalizeOpacityValue(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' && !value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const clamped = Math.max(0, Math.min(1, parsed));
  return String(Math.round(clamped * 1000) / 1000);
}

// ── Multi-role model ──────────────────────────────────────────────────────
// A user holds one base status plus, for members, any additive admin
// capabilities. `admin` implies every capability. The legacy single `role`
// column is kept as the derived "primary" role for backward compatibility.
const BASE_ROLES = ['member', 'guest', 'admin', 'disabled', 'vendor'];
const CAPABILITY_ROLES = ['store_admin', 'float_admin', 'finance_admin'];
const ALL_ROLES = [...BASE_ROLES, ...CAPABILITY_ROLES];
// Highest-privilege-first ordering used to pick a single primary role.
const ROLE_PRIORITY = ['disabled', 'admin', 'store_admin', 'float_admin', 'finance_admin', 'member', 'guest', 'vendor'];

// Normalize an arbitrary roles input (an array, or a legacy single-role string)
// into the canonical set: exactly one base status plus, for members, any
// additive admin capabilities. Guests, admins and disabled accounts never carry
// separate capabilities (admin already implies all; guests/disabled cannot).
function normalizeRoleSet(input) {
  let tokens = [];
  if (Array.isArray(input)) tokens = input;
  else if (typeof input === 'string' && input) tokens = [input];
  const set = new Set(tokens.map((t) => String(t).trim()).filter((t) => ALL_ROLES.includes(t)));
  let base;
  if (set.has('disabled')) base = 'disabled';
  else if (set.has('admin')) base = 'admin';
  else if (set.has('vendor')) base = 'vendor';
  else if (set.has('guest') && !set.has('member')) base = 'guest';
  else base = 'member';
  const result = [base];
  if (base === 'member') {
    for (const cap of CAPABILITY_ROLES) if (set.has(cap)) result.push(cap);
  }
  return result;
}

// The single "primary" role derived from a role set, most privileged first.
function primaryRole(roles) {
  const set = new Set(Array.isArray(roles) ? roles : normalizeRoleSet(roles));
  for (const r of ROLE_PRIORITY) if (set.has(r)) return r;
  return 'member';
}

// The effective role set for the authenticated request. Prefers the normalized
// `roles` array attached by the auth middleware, falling back to the legacy
// single `role` for safety.
function rolesOf(req) {
  if (req && req.user && Array.isArray(req.user.roles) && req.user.roles.length) return req.user.roles;
  if (req && req.user && req.user.role) return normalizeRoleSet(req.user.role);
  return [];
}

// Whether the request's user holds `role` (admin satisfies any capability).
function reqHasRole(req, role) {
  const roles = rolesOf(req);
  if (role !== 'admin' && roles.includes('admin')) return true;
  return roles.includes(role);
}

function isAdmin(req) {
  return rolesOf(req).includes('admin');
}

function isShopManager(req) {
  return reqHasRole(req, 'store_admin');
}

// Limited-admin roles scoped to a single domain, exactly like store_admin is
// scoped to the shop. `admin` is always included so a full admin can act
// through any of these paths. These roles are also treated as "elevated" for
// MFA purposes (see authController.isElevatedRole).
function isFloatAdmin(req) {
  return reqHasRole(req, 'float_admin');
}

function isFinanceAdmin(req) {
  return reqHasRole(req, 'finance_admin');
}

module.exports = {
  ADMIN_EDIT_EXCLUDED_PAGES,
  HEX_COLOR_PATTERN,
  LENGTH_VALUE_PATTERN,
  BORDER_STYLE_VALUES,
  normalizePagePath,
  isAdminEditablePagePath,
  validateEditablePagePath,
  normalizeHexColor,
  normalizeLengthValue,
  normalizeBorderStyle,
  normalizePositionMode,
  normalizeCoordinate,
  normalizeOpacityValue,
  isAdmin,
  isShopManager,
  isFloatAdmin,
  isFinanceAdmin,
  BASE_ROLES,
  CAPABILITY_ROLES,
  ALL_ROLES,
  ROLE_PRIORITY,
  normalizeRoleSet,
  primaryRole,
  rolesOf,
  reqHasRole,
};
