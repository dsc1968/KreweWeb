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

function isAdmin(req) {
  return Boolean(req.user && req.user.role === 'admin');
}

function isShopManager(req) {
  return Boolean(req.user && (req.user.role === 'admin' || req.user.role === 'store_admin'));
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
};
