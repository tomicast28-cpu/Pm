import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Empleados' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Empleados"
      phase="fase 5"
      description="Permisos, asistencia, comisiones y adelantos."
      scope={['Permisos por usuario', 'Ventas por empleado', 'Entrada y salida', 'Adelantos y comisiones', 'Tareas']}
    />
  );
}
