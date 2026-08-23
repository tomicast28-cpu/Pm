'use client';

import { useState, useTransition } from 'react';
import {
  applyCatalogImport,
  previewCatalogImport,
  revertCatalogImport,
  type PreviewResult,
} from '@/server/actions/import';
import { Badge, Button, Card, EmptyState } from '@/components/ui';
import { formatDateTime } from '@/lib/format';
import { cn } from '@/lib/cn';

type Job = {
  id: string;
  kind: string;
  file_name: string | null;
  status: string;
  total_rows: number;
  applied_rows: number;
  error_rows: number;
  created_at: string;
  summary: Record<string, number> | null;
};

const EXPORTS = [
  { slug: 'catalogo', label: 'Catálogo', note: 'Productos, variantes y disponibilidad' },
  { slug: 'stock', label: 'Stock', note: 'Existencias por ubicación' },
  { slug: 'movimientos', label: 'Movimientos', note: 'Libro de movimientos de stock' },
  { slug: 'ventas', label: 'Ventas', note: 'Ventas con totales y saldos' },
  { slug: 'caja', label: 'Caja', note: 'Sesiones, arqueos y diferencias' },
  { slug: 'rentabilidad', label: 'Rentabilidad', note: 'Costos y contribución · solo dueño' },
];

export function DataScreen({ jobs }: { jobs: Job[] }) {
  const [preview, setPreview] = useState<PreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const validProducts = preview?.parsed.products.filter((r) => r.status === 'valid') ?? [];
  const validBundles = preview?.parsed.bundles.filter((r) => r.status === 'valid') ?? [];
  const problemRows = [
    ...(preview?.parsed.products.filter((r) => r.status !== 'valid') ?? []),
    ...(preview?.parsed.bundles.filter((r) => r.status !== 'valid') ?? []),
  ];

  function downloadErrors() {
    if (!preview) return;
    const blob = new Blob([preview.errorReport], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'errores-importacion.csv';
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">Importar y exportar</h1>
        <p className="text-sm text-madera-500">
          La importación previsualiza y valida antes de tocar nada. Un SKU que ya existe no se
          sobrescribe: se informa y se omite.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}
      {notice && (
        <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{notice}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Importar catálogo">
          <form
            className="space-y-3 p-4"
            action={(formData) =>
              startTransition(async () => {
                setError(null);
                setNotice(null);
                setPreview(null);
                const result = await previewCatalogImport(formData);
                if (!result.ok) setError(result.error);
                else setPreview(result.data);
              })
            }
          >
            <p className="text-sm text-madera-600">
              Descargá la{' '}
              <a
                href="/plantillas/plantilla-catalogo-punto-madera.xlsx"
                className="text-madera-800 underline"
              >
                plantilla XLSX
              </a>{' '}
              y completala. La hoja «Instrucciones» explica cada columna.
            </p>
            <input
              type="file"
              name="archivo"
              accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              required
              aria-label="Archivo a importar"
              className="w-full rounded-lg border border-madera-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-madera-100 file:px-3 file:py-1 file:text-sm file:text-madera-800"
            />
            <Button type="submit" variant="secondary" className="w-full" disabled={pending}>
              {pending ? 'Leyendo…' : 'Previsualizar'}
            </Button>
          </form>
        </Card>

        <Card title="Exportar a Excel">
          <ul className="divide-y divide-madera-100">
            {EXPORTS.map((item) => (
              <li key={item.slug} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div>
                  <p className="text-sm text-madera-900">{item.label}</p>
                  <p className="text-xs text-madera-500">{item.note}</p>
                </div>
                <a
                  href={`/api/exportar/${item.slug}`}
                  className="rounded-lg border border-madera-300 px-3 py-1.5 text-xs text-madera-800 hover:bg-madera-50"
                >
                  Descargar
                </a>
              </li>
            ))}
          </ul>
        </Card>
      </div>

      {preview && (
        <Card
          title={`Previsualización · ${preview.fileName}`}
          action={
            problemRows.length > 0 ? (
              <button onClick={downloadErrors} className="text-xs text-madera-700 underline">
                Descargar errores (CSV)
              </button>
            ) : undefined
          }
        >
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap gap-2">
              <Badge tone="good">{validProducts.length} productos listos</Badge>
              {validBundles.length > 0 && (
                <Badge tone="info">{validBundles.length} componentes de combo</Badge>
              )}
              {preview.parsed.summary.duplicates > 0 && (
                <Badge tone="warn">{preview.parsed.summary.duplicates} SKU ya existentes</Badge>
              )}
              {preview.parsed.summary.errors > 0 && (
                <Badge tone="bad">{preview.parsed.summary.errors} con error</Badge>
              )}
            </div>

            {problemRows.length > 0 && (
              <div className="max-h-56 overflow-y-auto rounded-lg border border-madera-200">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-madera-50">
                    <tr className="text-left text-madera-500">
                      <th className="px-3 py-1.5 font-medium">Fila</th>
                      <th className="px-3 py-1.5 font-medium">SKU</th>
                      <th className="px-3 py-1.5 font-medium">Problema</th>
                    </tr>
                  </thead>
                  <tbody>
                    {problemRows.map((row, index) => {
                      const sku =
                        'sku' in row.data ? (row.data.sku ?? '—') : row.data.skuCombo;
                      return (
                        <tr key={`${row.rowNumber}-${index}`} className="border-t border-madera-100">
                          <td className="px-3 py-1.5 text-madera-600">{row.rowNumber}</td>
                          <td className="px-3 py-1.5">{sku}</td>
                          <td
                            className={cn(
                              'px-3 py-1.5',
                              row.status === 'duplicate' ? 'text-amber-700' : 'text-fuego-600',
                            )}
                          >
                            {row.status === 'duplicate'
                              ? 'El SKU ya existe en el catálogo: se omitirá'
                              : row.errors.join(' · ')}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            <p className="text-xs text-madera-500">
              Se importarán únicamente las {validProducts.length} filas válidas. El stock inicial se
              registra como movimiento de inventario, no como una escritura directa de saldos.
            </p>

            <Button
              className="w-full"
              disabled={pending || validProducts.length === 0}
              onClick={() =>
                startTransition(async () => {
                  setError(null);
                  const result = await applyCatalogImport({
                    fileName: preview.fileName,
                    rows: validProducts.map((row) => ({
                      fila: row.rowNumber,
                      nombre: row.data.nombre,
                      categoria: row.data.categoria,
                      variante: row.data.variante,
                      atributos: row.data.atributos,
                      sku: row.data.sku,
                      codigo_barras: row.data.codigoBarras,
                      proveedor: row.data.proveedor,
                      costo: row.data.costo,
                      precio_lista: row.data.precioLista,
                      precio_transferencia: row.data.precioTransferencia,
                      precio_mayorista: row.data.precioMayorista,
                      stock_salon: row.data.stockSalon,
                      stock_altillo: row.data.stockAltillo,
                      stock_minimo: row.data.stockMinimo,
                      tipo: row.data.tipo,
                      activo: row.data.activo,
                    })),
                    bundles: validBundles.map((row) => ({
                      fila: row.rowNumber,
                      sku_combo: row.data.skuCombo,
                      sku_componente: row.data.skuComponente,
                      cantidad: row.data.cantidad,
                    })),
                  });

                  if (!result.ok) {
                    setError(result.error);
                    return;
                  }
                  setPreview(null);
                  setNotice(
                    `Importación aplicada: ${result.data.creadas} productos creados` +
                      (result.data.omitidas > 0 ? `, ${result.data.omitidas} omitidos` : '') +
                      (result.data.componentes > 0
                        ? `, ${result.data.componentes} componentes de combo`
                        : '') +
                      '.',
                  );
                })
              }
            >
              {pending ? 'Importando…' : `Importar ${validProducts.length} productos`}
            </Button>
          </div>
        </Card>
      )}

      <Card title="Importaciones anteriores">
        {jobs.length === 0 ? (
          <EmptyState title="Todavía no se importó nada" />
        ) : (
          <ul className="divide-y divide-madera-100">
            {jobs.map((job) => (
              <li key={job.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm text-madera-900">
                    {job.file_name ?? 'Importación'}
                  </p>
                  <p className="text-xs text-madera-500">
                    {formatDateTime(job.created_at)} · {job.applied_rows} aplicadas
                    {job.error_rows > 0 && ` · ${job.error_rows} omitidas`}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge tone={job.status === 'applied' ? 'good' : 'neutral'}>
                    {job.status === 'applied' ? 'Aplicada' : 'Revertida'}
                  </Badge>
                  {job.status === 'applied' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => {
                        const reason = window.prompt(
                          'Motivo para revertir esta importación (queda auditado):',
                        );
                        if (!reason) return;
                        startTransition(async () => {
                          setError(null);
                          setNotice(null);
                          const result = await revertCatalogImport({ job_id: job.id, reason });
                          if (!result.ok) setError(result.error);
                          else
                            setNotice(
                              `Importación revertida: se eliminaron ${result.data.eliminadas} productos.`,
                            );
                        });
                      }}
                    >
                      Revertir
                    </Button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
