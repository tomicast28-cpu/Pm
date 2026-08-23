import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Reportes' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Reportes"
      phase="fase 4"
      description="Rankings, rotación, ABC y rentabilidad."
      scope={['Ranking por unidades, facturación y aporte', 'Stock clavado por antigüedad', 'ABC/Pareto', 'Rotación, cobertura y GMROI', 'Exportación XLSX respetando filtros']}
    />
  );
}
