'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/cn';

export type NavItem = { href: string; label: string; badge?: string };

export function SideNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Menú principal" className="flex flex-col gap-0.5 p-2">
      {items.map((item) => {
        const active =
          item.href === '/' ? pathname === '/' : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center justify-between rounded-lg px-3 py-2 text-sm transition-colors',
              active
                ? 'bg-madera-600 font-medium text-white'
                : 'text-madera-100 hover:bg-madera-700',
            )}
          >
            <span>{item.label}</span>
            {item.badge && (
              <span className="rounded-full bg-fuego-500 px-1.5 py-0.5 text-[10px] font-semibold text-white">
                {item.badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
