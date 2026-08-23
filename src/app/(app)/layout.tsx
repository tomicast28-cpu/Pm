import { AppShell } from '@/components/app-shell';
import { requireSession } from '@/server/session';

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await requireSession();
  return <AppShell session={session}>{children}</AppShell>;
}
