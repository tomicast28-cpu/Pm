import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Carteles' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Carteles"
      phase="fase 4"
      description="Generador de carteles y etiquetas."
      scope={['Plantillas SVG deterministas', 'A4, A5, cuadrado, 4:5 e historia', 'Foto y precio anterior opcionales', 'Exportación PNG y PDF', 'Generación desde un producto clavado']}
    />
  );
}
