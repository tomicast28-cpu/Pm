import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Entregas y retiros' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Entregas y retiros"
      phase="fase 2"
      description="Retiros en local, entregas propias y por fletero."
      scope={['Preparación y entrega parcial', 'Remito por cumplimiento', 'Cobro por fletero y rendición', 'Zonas y tarifas de envío editables', 'Prueba de entrega']}
    />
  );
}
