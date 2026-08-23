/**
 * Permisos.
 *
 * Este archivo decide qué se MUESTRA. Quien decide qué se PUEDE HACER es la
 * base de datos: cada función transaccional revalida el permiso y la RLS filtra
 * las filas. Si alguna vez estos dos criterios discrepan, gana la base.
 */

export type UserRole = 'owner' | 'employee';

export const PERMISSIONS = {
  salesCreate: 'sales.create',
  salesReverse: 'sales.reverse',
  paymentsCreate: 'payments.create',
  customersManage: 'customers.manage',
  cashOpen: 'cash.open',
  cashClose: 'cash.close',
  cashMovement: 'cash.movement',
  cashReopen: 'cash.reopen',
  stockTransfer: 'stock.transfer',
  stockAdjust: 'stock.adjust',
  stockAssemble: 'stock.assemble',
  stockOnlineExit: 'stock.online_exit',
  catalogManage: 'catalog.manage',
  pricesManage: 'prices.manage',
  costsView: 'costs.view',
  reportsView: 'reports.view',
  ordersManage: 'orders.manage',
  fulfillmentsManage: 'fulfillments.manage',
  postersManage: 'posters.manage',
  suppliersManage: 'suppliers.manage',
  settingsManage: 'settings.manage',
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Permisos del empleado según la sección 5.2 de la especificación. */
const EMPLOYEE_DEFAULTS: Permission[] = [
  PERMISSIONS.salesCreate,
  PERMISSIONS.paymentsCreate,
  PERMISSIONS.customersManage,
  PERMISSIONS.cashOpen,
  PERMISSIONS.cashClose,
  PERMISSIONS.cashMovement,
  PERMISSIONS.stockTransfer,
  PERMISSIONS.stockOnlineExit,
  PERMISSIONS.stockAssemble,
  PERMISSIONS.ordersManage,
  PERMISSIONS.fulfillmentsManage,
  PERMISSIONS.postersManage,
];

export function can(
  role: UserRole,
  permission: Permission,
  overrides?: Record<string, boolean>,
): boolean {
  if (role === 'owner') return true;
  if (overrides && permission in overrides) return overrides[permission]!;
  return EMPLOYEE_DEFAULTS.includes(permission);
}
