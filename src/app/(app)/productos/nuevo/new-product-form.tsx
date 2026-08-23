'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { createProduct } from '@/server/actions/catalog';
import { Button, Card, Field, Input, Select, Badge } from '@/components/ui';
import { cn } from '@/lib/cn';
import { inputClass } from '@/components/ui';

type Kind = 'simple' | 'variant' | 'service' | 'bundle_virtual' | 'bundle_stocked';

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'simple', label: 'Simple', hint: 'Un producto, un SKU.' },
  { value: 'variant', label: 'Con variantes', hint: 'Mismo producto en colores o medidas.' },
  { value: 'service', label: 'Servicio', hint: 'Grabado, envío o armado. No lleva stock.' },
  {
    value: 'bundle_virtual',
    label: 'Combo virtual',
    hint: 'No tiene stock propio: al venderlo se descuentan sus piezas.',
  },
  {
    value: 'bundle_stocked',
    label: 'Combo prearmado',
    hint: 'Tiene stock propio: se arma consumiendo sus piezas.',
  },
];

type VariantDraft = {
  key: string;
  sku: string;
  name: string;
  price: string;
  minStock: string;
  attributes: string;
  locationId: string;
};

type ComponentDraft = { key: string; variantId: string; quantity: string };

export function NewProductForm({
  categories,
  locations,
  components: availableComponents,
}: {
  categories: { id: string; name: string }[];
  locations: { id: string; name: string; is_default: boolean }[];
  components: { variant_id: string; sku: string; display_name: string }[];
}) {
  const router = useRouter();
  const defaultLocation = locations.find((l) => l.is_default)?.id ?? locations[0]?.id ?? '';

  const [kind, setKind] = useState<Kind>('simple');
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [handcrafted, setHandcrafted] = useState(false);
  const [customization, setCustomization] = useState(false);
  const [variants, setVariants] = useState<VariantDraft[]>([
    {
      key: crypto.randomUUID(),
      sku: '',
      name: '',
      price: '',
      minStock: '0',
      attributes: '',
      locationId: defaultLocation,
    },
  ]);
  const [components, setComponents] = useState<ComponentDraft[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const isBundle = kind === 'bundle_virtual' || kind === 'bundle_stocked';
  const allowsMultipleVariants = kind === 'variant';

  const updateVariant = (key: string, patch: Partial<VariantDraft>) =>
    setVariants((prev) => prev.map((v) => (v.key === key ? { ...v, ...patch } : v)));

  function parseAttributes(raw: string): Record<string, string> {
    const result: Record<string, string> = {};
    for (const pair of raw.split(';')) {
      const [key, ...rest] = pair.split('=');
      if (!key || rest.length === 0) continue;
      const k = key.trim();
      const v = rest.join('=').trim();
      if (k && v) result[k] = v;
    }
    return result;
  }

  function submit() {
    startTransition(async () => {
      setError(null);

      if (isBundle && components.length === 0) {
        setError('Un combo necesita al menos un componente.');
        return;
      }

      const result = await createProduct({
        name,
        kind,
        category_id: categoryId || null,
        short_description: description || undefined,
        is_handcrafted: handcrafted,
        requires_customization: customization,
        variants: variants.map((v) => ({
          sku: v.sku || undefined,
          name: v.name,
          attributes: parseAttributes(v.attributes),
          min_stock: Number(v.minStock) || 0,
          price: v.price || '0',
          preferred_location_id: v.locationId || null,
        })),
        components: isBundle
          ? components
              .filter((c) => c.variantId)
              .map((c) => ({
                component_variant_id: c.variantId,
                quantity: Number(c.quantity) || 1,
              }))
          : undefined,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }
      router.push('/productos');
      router.refresh();
    });
  }

  return (
    <div className="max-w-3xl space-y-4">
      <header>
        <h1 className="text-xl font-semibold text-madera-900">Nuevo producto</h1>
        <p className="text-sm text-madera-500">
          El stock inicial se carga después, desde Stock o por importación: así queda como
          movimiento de inventario y no como una cantidad escrita a mano.
        </p>
      </header>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      )}

      <Card title="Tipo de producto">
        <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
          {KINDS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setKind(option.value);
                if (option.value !== 'variant') setVariants((prev) => prev.slice(0, 1));
              }}
              className={cn(
                'rounded-lg border px-3 py-2 text-left transition-colors',
                kind === option.value
                  ? 'border-madera-600 bg-madera-50'
                  : 'border-madera-200 hover:border-madera-400',
              )}
            >
              <span className="block text-sm font-medium text-madera-900">{option.label}</span>
              <span className="mt-0.5 block text-xs text-madera-500">{option.hint}</span>
            </button>
          ))}
        </div>
      </Card>

      <Card title="Datos del producto">
        <div className="grid gap-3 p-4 sm:grid-cols-2">
          <Field label="Nombre" className="sm:col-span-2">
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej.: Canasto de zuncho"
              required
            />
          </Field>
          <Field label="Categoría">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">Sin categoría</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Descripción corta">
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-madera-700">
            <input
              type="checkbox"
              checked={handcrafted}
              onChange={(e) => setHandcrafted(e.target.checked)}
            />
            Artesanal
          </label>
          <label className="flex items-center gap-2 text-sm text-madera-700">
            <input
              type="checkbox"
              checked={customization}
              onChange={(e) => setCustomization(e.target.checked)}
            />
            Requiere personalización
          </label>
        </div>
      </Card>

      <Card
        title={allowsMultipleVariants ? 'Variantes' : 'Datos de venta'}
        action={
          allowsMultipleVariants ? (
            <button
              type="button"
              onClick={() =>
                setVariants((prev) => [
                  ...prev,
                  {
                    key: crypto.randomUUID(),
                    sku: '',
                    name: '',
                    price: '',
                    minStock: '0',
                    attributes: '',
                    locationId: defaultLocation,
                  },
                ])
              }
              className="text-xs text-madera-700 underline"
            >
              + Agregar variante
            </button>
          ) : undefined
        }
      >
        <ul className="divide-y divide-madera-100">
          {variants.map((variant, index) => (
            <li key={variant.key} className="grid gap-3 p-4 sm:grid-cols-2">
              {allowsMultipleVariants && (
                <div className="flex items-center justify-between sm:col-span-2">
                  <Badge>Variante {index + 1}</Badge>
                  {variants.length > 1 && (
                    <button
                      type="button"
                      onClick={() =>
                        setVariants((prev) => prev.filter((v) => v.key !== variant.key))
                      }
                      className="text-xs text-fuego-600 underline"
                    >
                      Quitar
                    </button>
                  )}
                </div>
              )}
              {allowsMultipleVariants && (
                <Field label="Nombre de la variante">
                  <Input
                    value={variant.name}
                    onChange={(e) => updateVariant(variant.key, { name: e.target.value })}
                    placeholder="Ej.: Negro 30x20x15"
                  />
                </Field>
              )}
              <Field label="SKU" hint="Vacío = se genera automáticamente.">
                <Input
                  value={variant.sku}
                  onChange={(e) => updateVariant(variant.key, { sku: e.target.value })}
                  placeholder="PM-00010"
                />
              </Field>
              <Field label="Precio de lista" hint="Con IVA incluido.">
                <Input
                  value={variant.price}
                  onChange={(e) => updateVariant(variant.key, { price: e.target.value })}
                  inputMode="decimal"
                  className="tabular"
                  placeholder="18500"
                />
              </Field>
              {kind !== 'service' && (
                <>
                  <Field label="Stock mínimo">
                    <Input
                      value={variant.minStock}
                      onChange={(e) => updateVariant(variant.key, { minStock: e.target.value })}
                      inputMode="decimal"
                      className="tabular"
                    />
                  </Field>
                  <Field label="Ubicación preferida">
                    <Select
                      value={variant.locationId}
                      onChange={(e) => updateVariant(variant.key, { locationId: e.target.value })}
                    >
                      {locations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.name}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </>
              )}
              <Field
                label="Atributos"
                hint="Pares clave=valor separados por «;». Ej.: color=Negro;medida=30x20x15"
                className="sm:col-span-2"
              >
                <Input
                  value={variant.attributes}
                  onChange={(e) => updateVariant(variant.key, { attributes: e.target.value })}
                />
              </Field>
            </li>
          ))}
        </ul>
      </Card>

      {isBundle && (
        <Card
          title="Componentes del combo"
          action={
            <button
              type="button"
              onClick={() =>
                setComponents((prev) => [
                  ...prev,
                  { key: crypto.randomUUID(), variantId: '', quantity: '1' },
                ])
              }
              className="text-xs text-madera-700 underline"
            >
              + Agregar componente
            </button>
          }
        >
          <div className="space-y-2 p-4">
            <p className="text-xs text-madera-500">
              {kind === 'bundle_virtual'
                ? 'Al vender el combo se descuentan estas piezas, y su disponibilidad es la que ellas permitan.'
                : 'El combo se arma desde Stock consumiendo estas piezas.'}
            </p>
            {components.length === 0 && (
              <p className="text-sm text-madera-500">Todavía no agregaste componentes.</p>
            )}
            {components.map((component) => (
              <div key={component.key} className="flex gap-2">
                <Select
                  value={component.variantId}
                  onChange={(e) =>
                    setComponents((prev) =>
                      prev.map((c) =>
                        c.key === component.key ? { ...c, variantId: e.target.value } : c,
                      ),
                    )
                  }
                  aria-label="Componente"
                  className="flex-1"
                >
                  <option value="">Elegí una pieza…</option>
                  {availableComponents.map((c) => (
                    <option key={c.variant_id} value={c.variant_id}>
                      {c.display_name} ({c.sku})
                    </option>
                  ))}
                </Select>
                <input
                  value={component.quantity}
                  onChange={(e) =>
                    setComponents((prev) =>
                      prev.map((c) =>
                        c.key === component.key ? { ...c, quantity: e.target.value } : c,
                      ),
                    )
                  }
                  inputMode="decimal"
                  aria-label="Cantidad"
                  className={cn(inputClass, 'tabular w-20 text-center')}
                />
                <button
                  type="button"
                  onClick={() =>
                    setComponents((prev) => prev.filter((c) => c.key !== component.key))
                  }
                  className="px-2 text-fuego-600"
                  aria-label="Quitar componente"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        </Card>
      )}

      <div className="flex gap-2">
        <Button size="lg" onClick={submit} disabled={pending || name.trim().length < 2}>
          {pending ? 'Guardando…' : 'Crear producto'}
        </Button>
        <Button size="lg" variant="secondary" onClick={() => router.push('/productos')}>
          Cancelar
        </Button>
      </div>
    </div>
  );
}
