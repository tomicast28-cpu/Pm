import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Cuentas corrientes' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Cuentas corrientes"
      phase="fase 2"
      description="Saldos, vencimientos y cobros parciales."
      scope={['Saldo por cliente', 'Deuda vencida y por vencer', 'Cobros parciales', 'Bloqueo por mora configurable']}
    />
  );
}
