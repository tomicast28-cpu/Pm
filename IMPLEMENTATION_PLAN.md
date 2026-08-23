# Plan de implementación — Punto Madera

Traducción de las fases de `Punto_Madera_Sistema_Master_Spec.md` a tareas concretas,
con dependencias y criterios de finalización verificables.

Estado de este documento: vivo. Se actualiza al cerrar cada hito.

## Convenciones

- **Fuente de verdad**: PostgreSQL (Supabase). La aplicación nunca escribe saldos,
  stock ni caja de forma directa: siempre a través de funciones transaccionales
  `SECURITY DEFINER`.
- **Dinero**: `numeric(14,2)` en base; en TypeScript se opera con enteros de centavos
  (`bigint`) mediante `src/lib/money.ts`. Nunca `float`.
- **Cantidades**: `numeric(14,3)` para no cerrar la puerta a unidades fraccionables.
- **Auditoría**: toda operación sensible escribe en `audit_logs` dentro de la misma
  transacción que la modifica.
- **Idioma**: toda la interfaz en español rioplatense, formato `es-AR`, zona
  `America/Argentina/Buenos_Aires`.

---

## Fase 0 — Base técnica

Objetivo: que exista un proyecto ejecutable, con base versionada, autenticación,
separación dueño/empleado probada a nivel base de datos y CI verde.

| # | Tarea | Depende de | Criterio de finalización |
|---|-------|-----------|--------------------------|
| 0.1 | Scaffolding Next.js 15 (App Router) + TypeScript estricto + Tailwind | — | `npm run typecheck` y `npm run lint` pasan |
| 0.2 | Estructura de migraciones SQL versionadas y script de base local | 0.1 | `npm run db:reset` reconstruye la base desde cero sin error |
| 0.3 | Esquema `app` con helpers de sesión (`current_org_id`, `is_owner`, `has_permission`) | 0.2 | Tests SQL de helpers pasan |
| 0.4 | Organización, sucursal, ubicaciones (Salón/Altillo), configuración y marca | 0.3 | Semilla crea 1 organización, 1 sucursal, 2 ubicaciones |
| 0.5 | Usuarios: `user_profiles`, `employee_profiles`, `role_permissions` | 0.4 | Dueño y empleado demo pueden iniciar sesión |
| 0.6 | RLS habilitada en **todas** las tablas expuestas | 0.4, 0.5 | No existe tabla sin `ENABLE ROW LEVEL SECURITY` (test automático) |
| 0.7 | Aislamiento de costos: tablas de costo separadas, legibles solo por dueño | 0.6 | Empleado recibe 0 filas al consultar costos vía API/PostgREST |
| 0.8 | Auditoría base (`audit_logs` + `app.audit()`) | 0.3 | Login y cambios de precio/costo quedan registrados |
| 0.9 | Datos demo identificables y borrables (`is_demo`) | 0.4–0.7 | `select app.purge_demo_data()` deja la base limpia |
| 0.10 | Layout, tema, navegación por rol, PWA (manifest + iconos) | 0.1 | Menú del empleado oculta áreas no autorizadas |
| 0.11 | CI: typecheck, lint, unit, SQL, e2e | todas | Workflow verde |

**Criterio de cierre de fase 0**: un dueño y un empleado inician sesión, ven menús
distintos, y el empleado no puede leer costos ni por interfaz ni por consulta directa.

---

## Fase 1 — Núcleo operativo

Objetivo: poder operar **un día completo de local** con el sistema.

### 1.1 Catálogo, variantes y combos
- `categories`, `products`, `product_variants`, `product_images`, `bundle_components`.
- Tipos: simple, con variantes, servicio, combo virtual, combo prearmado.
- SKU automático editable mediante `document_sequences`.
- Precios por lista (`price_lists`, `variant_prices`) con derivación por porcentaje y redondeo.
- Costos (`variant_costs`, `cost_history`) aislados del empleado.
- **Fin**: alta de producto simple, con variantes, combo virtual y prearmado desde la UI.

### 1.2 Stock, lotes, movimientos y transferencias
- `inventory_lots`, `inventory_movements(_items)`, `inventory_balances`, `stock_reservations`.
- `inventory_balances` es proyección transaccional; solo la escriben las funciones.
- Funciones: `apply_stock_delta` (primitiva), `transfer_stock`, `adjust_stock`,
  `assemble_bundle`, `disassemble_bundle`, `online_sale_exit`.
- Asignación FIFO de lotes en cada salida (para antigüedad y costo histórico).
- **Fin**: criterios de aceptación 1–3, 6–7, 21 y 27 (parte de stock) pasan.

### 1.3 Apertura de caja
- `cash_registers`, `cash_sessions`, `cash_movements`.
- `open_cash_session` valida sesión única por caja.
- **Fin**: criterio 16 pasa.

### 1.4 Venta inmediata
- `orders`, `order_items`, `order_item_costs`, `order_discounts`.
- `create_instant_sale`: valida stock (incluidos componentes de combos), descuenta,
  congela costos, registra pagos, mueve caja, genera comprobante y auditoría —
  todo en una transacción, con clave de idempotencia.
- **Fin**: criterios 1–7 pasan.

### 1.5 Pagos combinados
- `payment_methods` con comisión %, cargo fijo, días de acreditación, afecta efectivo.
- `payments`, `payment_allocations`; vuelto; sin vuelto negativo; idempotencia.
- **Fin**: criterios 12–14 pasan.

### 1.6 Descuento auditado
- Descuento por línea y por total; guarda precio original, final, importe, %,
  empleado y motivo.
- **Fin**: criterio 29 pasa.

### 1.7 Cierre de caja
- Esperado vs declarado por medio de pago, diferencias con motivo obligatorio,
  bloqueo del período, reapertura solo del dueño conservando el cierre original.
- **Fin**: criterios 17–20 pasan.

### 1.8 Comprobante
- Vista imprimible A4 + PDF, con pie de condiciones configurable.
- **Fin**: comprobante de venta se imprime correctamente en A4.

### 1.9 Importación/exportación básica
- Plantilla XLSX (catálogo + hoja de componentes de combo).
- Importación con previsualización, validación por fila, errores descargables,
  confirmación parcial y reversión del lote.
- Exportación XLSX de catálogo, stock, movimientos, ventas y caja.
- **Fin**: importar la plantilla semilla crea el catálogo sin sobrescribir en silencio.

**Criterio de cierre de fase 1**: el recorrido e2e *abrir caja → vender → cobrar
combinado → salida online → cerrar caja* pasa en Chromium, y los criterios de
aceptación 1–7, 12–14, 16–20, 28–30 pasan.

---

## Fase 2 — Pedidos y cumplimiento

Clientes · presupuestos · reservas y señas · cuenta corriente · encargos externos ·
grabados y medidas · retiros · entregas y remitos · cobro por fletero · devoluciones.

Funciones: `reserve_order_stock`, `release_order_reservation`, `fulfill_order`,
`process_return`, `record_customer_payment`, `reverse_sale`.

**Criterios objetivo**: 8–11, 15, 25–27.

---

## Fase 3 — Compras y gestión

Proveedores · compra rápida · lotes y costos · cuentas por pagar · vencimientos ·
importación de listas de proveedor · incidencias · actualización masiva de precios.

Funciones: `receive_purchase`, `record_supplier_payment`.

**Criterios objetivo**: 21–24.

---

## Fase 4 — Decisiones y cartelería

Dashboard completo · resúmenes diario y mensual · antigüedad de stock · ABC/Pareto ·
rotación · GMROI · afinidad · ventas perdidas · recomendaciones accionables ·
generador de carteles y etiquetas (SVG determinista → PNG/PDF/A4).

**Criterios objetivo**: 31–40.

---

## Fase 5 — Administración ampliada

Asistencia · tareas · comisiones · adelantos · sueldos · facturación ARCA mediante la
interfaz `FiscalProvider` · sincronización ecommerce · notificaciones externas.

---

## Dependencias entre fases

```
Fase 0 ──> Fase 1 ──┬──> Fase 2 ──┬──> Fase 4
                    └──> Fase 3 ──┘
                                   └──> Fase 5
```

La fase 4 necesita datos reales de ventas (fase 1), pedidos (fase 2) y compras
(fase 3) para que los indicadores no sean ficticios. Por eso el Centro de decisiones
muestra «Datos insuficientes» mientras no haya historia.

## Alcance entregado en esta iteración

Fases 0 y 1 completas, de punta a punta hasta la base de datos. El modelo de datos
de las fases 2 a 5 se crea en las migraciones (con RLS) para no rediseñar el núcleo
más adelante, pero sus pantallas y funciones se implementan en su fase.
El detalle honesto de qué está implementado y qué queda pendiente vive en
`ESTADO_REQUISITOS.md`.
