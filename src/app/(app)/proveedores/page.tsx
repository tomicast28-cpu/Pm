import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Proveedores' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Proveedores"
      phase="fase 3"
      description="Ficha, cuenta corriente e incidencias."
      scope={['Datos de contacto y CBU', 'Cuenta corriente y vencimientos', 'Incidencias y desempeño', 'Importación de listas por Excel']}
    />
  );
}
