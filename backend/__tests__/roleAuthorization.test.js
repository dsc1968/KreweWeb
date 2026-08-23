// Backend tests for the multi-role authorization model that underpins the
// vendor/member feature. Run with:
//   npx jest@29 --rootDir backend --testEnvironment node backend/__tests__/roleAuthorization.test.js
const {
  normalizeRoleSet,
  primaryRole,
  rolesOf,
  reqHasRole,
  isAdmin,
  isShopManager,
  isFloatAdmin,
  isFinanceAdmin,
} = require('../utils/validation');

describe('normalizeRoleSet', () => {
  test('wraps a single legacy role string', () => {
    expect(normalizeRoleSet('member')).toEqual(['member']);
  });

  test('keeps a vendor base role with no additive capabilities', () => {
    expect(normalizeRoleSet(['vendor'])).toEqual(['vendor']);
  });

  test('adds capabilities only for a member base', () => {
    expect(normalizeRoleSet(['member', 'store_admin'])).toEqual(['member', 'store_admin']);
  });

  test('admin implies everything and never carries separate caps', () => {
    expect(normalizeRoleSet(['admin', 'store_admin'])).toEqual(['admin']);
  });

  test('a capability without an explicit member base still yields member', () => {
    expect(normalizeRoleSet(['store_admin'])).toEqual(['member', 'store_admin']);
  });

  test('disabled and guest are exclusive base statuses', () => {
    expect(normalizeRoleSet(['disabled'])).toEqual(['disabled']);
    expect(normalizeRoleSet(['guest'])).toEqual(['guest']);
  });

  test('unknown tokens are dropped and empty input falls back to member', () => {
    expect(normalizeRoleSet(['bogus', 'member'])).toEqual(['member']);
    expect(normalizeRoleSet([])).toEqual(['member']);
    expect(normalizeRoleSet('')).toEqual(['member']);
  });

  test('vendor base wins over a member capability', () => {
    expect(normalizeRoleSet(['vendor', 'member'])).toEqual(['vendor']);
  });
});

describe('primaryRole', () => {
  test('vendor is derived for a vendor role set', () => {
    expect(primaryRole(['vendor'])).toBe('vendor');
  });

  test('admin wins over capabilities', () => {
    expect(primaryRole(['member', 'store_admin', 'admin'])).toBe('admin');
  });

  test('a member with store_admin reports the capability as primary', () => {
    expect(primaryRole(['member', 'store_admin'])).toBe('store_admin');
  });

  test('empty / non-array input defaults to member', () => {
    expect(primaryRole([])).toBe('member');
    expect(primaryRole('')).toBe('member');
  });
});

describe('rolesOf', () => {
  test('prefers the roles array and falls back to legacy role', () => {
    expect(rolesOf({ user: { roles: ['member', 'store_admin'] } })).toEqual(['member', 'store_admin']);
    expect(rolesOf({ user: { role: 'vendor' } })).toEqual(['vendor']);
    expect(rolesOf({})).toEqual([]);
  });
});

describe('isAdmin', () => {
  test('true only for an admin role set', () => {
    expect(isAdmin({ user: { roles: ['admin'] } })).toBe(true);
    expect(isAdmin({ user: { roles: ['member', 'store_admin'] } })).toBe(false);
    expect(isAdmin({})).toBe(false);
  });
});

describe('isShopManager', () => {
  test('true for store_admin or full admin', () => {
    expect(isShopManager({ user: { roles: ['member', 'store_admin'] } })).toBe(true);
    expect(isShopManager({ user: { roles: ['admin'] } })).toBe(true);
    expect(isShopManager({ user: { roles: ['member'] } })).toBe(false);
    expect(isShopManager({})).toBe(false);
  });
});

describe('isFloatAdmin / isFinanceAdmin', () => {
  test('scoped capability roles plus admin', () => {
    expect(isFloatAdmin({ user: { roles: ['member', 'float_admin'] } })).toBe(true);
    expect(isFinanceAdmin({ user: { roles: ['member', 'finance_admin'] } })).toBe(true);
    expect(isFloatAdmin({ user: { roles: ['admin'] } })).toBe(true);
    expect(isFinanceAdmin({ user: { roles: ['member', 'store_admin'] } })).toBe(false);
  });
});

describe('reqHasRole', () => {
  test('admin satisfies any requested capability', () => {
    const req = { user: { roles: ['admin'] } };
    expect(reqHasRole(req, 'store_admin')).toBe(true);
    expect(reqHasRole(req, 'vendor')).toBe(true);
  });

  test('a plain member does not satisfy capabilities', () => {
    const req = { user: { roles: ['member'] } };
    expect(reqHasRole(req, 'store_admin')).toBe(false);
  });
});
