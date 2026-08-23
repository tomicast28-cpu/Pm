import Link from 'next/link';
import { SideNav, type NavItem } from './nav';
import { PERMISSIONS } from '@/lib/permissions';
import { sessionCan, type SessionContext } from '@/server/session';
import { signOut } from '@/server/actions/auth';

/**
 * Estructura de la aplicación. El menú del empleado oculta las áreas que no
 * tiene autorizadas (6.1); ocultarlas es una comodidad, no la protección:
 * esa la da la base de datos.
 */
export function AppShell({
  session,
  children,
}: {
  session: SessionContext;
  children: React.ReactNode;
}) {
  const isOwner = session.role === 'owner';

  const items: NavItem[] = [
    { href: '/', label: 'Inicio' },
    { href: '/venta', label: 'Nueva venta' },
    { href: '/pedidos', label: 'Pedidos y presupuestos' },
    { href: '/entregas', label: 'Entregas y retiros' },
    { href: '/productos', label: 'Productos' },
    { href: '/stock', label: 'Stock' },
    ...(sessionCan(session, PERMISSIONS.suppliersManage)
      ? [
          { href: '/compras', label: 'Compras' },
          { href: '/proveedores', label: 'Proveedores' },
        ]
      : []),
    { href: '/clientes', label: 'Clientes' },
    { href: '/caja', label: 'Caja' },
    ...(isOwner ? [{ href: '/cuentas', label: 'Cuentas corrientes' }] : []),
    { href: '/carteles', label: 'Carteles' },
    ...(isOwner
      ? [
          { href: '/empleados', label: 'Empleados' },
          { href: '/reportes', label: 'Reportes' },
          { href: '/auditoria', label: 'Auditoría' },
          { href: '/configuracion', label: 'Configuración' },
        ]
      : []),
  ];

  return (
    <div className="flex min-h-screen">
      <aside className="no-print sticky top-0 hidden h-screen w-56 shrink-0 flex-col overflow-y-auto bg-madera-800 lg:flex">
        <Link href="/" className="block px-4 py-4">
          <p className="text-base font-semibold text-white">Punto Madera</p>
          <p className="text-xs text-madera-300">{session.branchName ?? 'Local'}</p>
        </Link>
        <SideNav items={items} />
        <div className="mt-auto border-t border-madera-700 p-3">
          <p className="truncate text-xs font-medium text-madera-100">{session.fullName}</p>
          <p className="text-xs text-madera-400">{isOwner ? 'Dueño' : 'Empleado'}</p>
          <form action={signOut}>
            <button
              type="submit"
              className="mt-2 text-xs text-madera-300 underline hover:text-white"
            >
              Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print flex items-center gap-3 overflow-x-auto border-b border-madera-200 bg-white px-4 py-2 lg:hidden">
          <Link href="/" className="text-sm font-semibold text-madera-800">
            Punto Madera
          </Link>
          {items.slice(0, 6).map((i) => (
            <Link key={i.href} href={i.href} className="whitespace-nowrap text-xs text-madera-600">
              {i.label}
            </Link>
          ))}
        </header>
        <main className="min-w-0 flex-1 p-4 lg:p-6">{children}</main>
      </div>
    </div>
  );
}
