import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Compras' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Compras"
      phase="fase 3"
      description="Recepción de mercadería, costos y lotes."
      scope={['Compra rápida al recibir', 'Comparación contra el costo anterior', 'Actualización de último costo tras confirmar', 'Recepción parcial', 'Pago total, parcial o deuda']}
    />
  );
}
