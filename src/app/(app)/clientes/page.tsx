import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Clientes' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Clientes"
      phase="fase 2"
      description="Ficha, historial y cuenta corriente."
      scope={['Alta de cliente minorista y mayorista', 'Historial de compras', 'Límite de crédito y vencimientos', 'Estado de cuenta imprimible']}
    />
  );
}
