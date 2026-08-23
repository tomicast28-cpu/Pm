import { cache } from 'react';
import { redirect } from 'next/navigation';
import { createClient } from '@/lib/supabase/server';
import type { Permission, UserRole } from '@/lib/permissions';
import { can } from '@/lib/permissions';

export type SessionContext = {
  userId: string;
  email: string | null;
  fullName: string;
  role: UserRole;
  organizationId: string;
  branchId: string | null;
  organizationName: string;
  branchName: string | null;
  permissionOverrides: Record<string, boolean>;
};

/**
 * Contexto del usuario en curso. `cache` evita repetir la consulta dentro del
 * mismo render.
 */
export const getSession = cache(async (): Promise<SessionContext | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: profile } = await supabase
    .from('user_profiles')
    .select('id, full_name, role, email, organization_id, branch_id')
    .eq('id', user.id)
    .maybeSingle();

  if (!profile) return null;

  const [{ data: org }, { data: branch }, { data: overrides }] = await Promise.all([
    supabase.from('organizations').select('name').eq('id', profile.organization_id).maybeSingle(),
    profile.branch_id
      ? supabase.from('branches').select('name').eq('id', profile.branch_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabase.from('role_permissions').select('permission, granted, user_id, role'),
  ]);

  // El permiso otorgado a la persona gana sobre el del rol.
  const permissionOverrides: Record<string, boolean> = {};
  for (const row of overrides ?? []) {
    if (row.user_id && row.user_id !== user.id) continue;
    if (!row.user_id && row.role !== profile.role) continue;
    if (row.user_id || !(row.permission in permissionOverrides)) {
      permissionOverrides[row.permission] = row.granted;
    }
  }

  return {
    userId: user.id,
    email: profile.email ?? user.email ?? null,
    fullName: profile.full_name,
    role: profile.role as UserRole,
    organizationId: profile.organization_id,
    branchId: profile.branch_id,
    organizationName: org?.name ?? 'Punto Madera',
    branchName: branch?.name ?? null,
    permissionOverrides,
  };
});

export async function requireSession(): Promise<SessionContext> {
  const session = await getSession();
  if (!session) redirect('/ingresar');
  return session;
}

export async function requireOwner(): Promise<SessionContext> {
  const session = await requireSession();
  if (session.role !== 'owner') redirect('/sin-permiso');
  return session;
}

export async function requirePermission(permission: Permission): Promise<SessionContext> {
  const session = await requireSession();
  if (!can(session.role, permission, session.permissionOverrides)) redirect('/sin-permiso');
  return session;
}

export function sessionCan(session: SessionContext, permission: Permission): boolean {
  return can(session.role, permission, session.permissionOverrides);
}
