import type { Metadata } from 'next';
import { PhasePlaceholder } from '@/components/phase-placeholder';

export const metadata: Metadata = { title: 'Pedidos y presupuestos' };

export default function Page() {
  return (
    <PhasePlaceholder
      title="Pedidos y presupuestos"
      phase="fase 2"
      description="Presupuestos, señas, reservas y encargos."
      scope={['Presupuesto con vigencia y precios congelados', 'Seña que reserva stock sin bajar el físico', 'Encargo a taller externo', 'Grabado y medidas especiales', 'Conversión de presupuesto a pedido sin recarga']}
    />
  );
}
