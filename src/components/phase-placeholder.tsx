import { Card } from '@/components/ui';

/**
 * Sección definida en la especificación pero implementada en una fase posterior.
 *
 * Se muestra explícitamente en lugar de esconder la sección o llenarla con
 * datos falsos: el sistema no debe simular que algo funciona cuando no llega
 * transaccionalmente a la base.
 */
export function PhasePlaceholder({
  title,
  phase,
  description,
  scope,
}: {
  title: string;
  phase: string;
  description: string;
  scope: string[];
}) {
  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">{title}</h1>
        <p className="text-sm text-madera-500">{description}</p>
      </header>

      <Card className="max-w-2xl">
        <div className="space-y-3 p-5">
          <p className="inline-block rounded-full bg-amber-100 px-2.5 py-0.5 text-xs font-medium text-amber-800">
            Previsto para la {phase}
          </p>
          <p className="text-sm text-madera-700">
            El modelo de datos, las políticas de acceso y la numeración de esta sección ya están
            creados en la base. Falta la pantalla y sus operaciones.
          </p>
          <div>
            <p className="mb-1 text-xs font-medium text-madera-600">Alcance previsto</p>
            <ul className="list-inside list-disc space-y-0.5 text-sm text-madera-600">
              {scope.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}
