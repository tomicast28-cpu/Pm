# Estado de los requisitos

Listado honesto de qué está implementado, qué está parcialmente implementado y
qué falta. Un requisito solo figura como implementado si llega
transaccionalmente a la base y tiene pruebas.

Leyenda: ✅ implementado · 🟡 parcial · ⬜ pendiente

---

## Fase 0 — Base técnica · ✅

| Requisito | Estado | Dónde |
|---|---|---|
| Proyecto Next.js 15 + TypeScript estricto + Tailwind | ✅ | raíz |
| Migraciones SQL versionadas y reproducibles | ✅ | `supabase/migrations/0001…0015` |
| Autenticación y sesión | ✅ | `src/lib/supabase/`, `src/middleware.ts` |
| Roles dueño/empleado | ✅ | `user_profiles.role`, `role_permissions` |
| Organización, sucursal, ubicaciones Salón/Altillo | ✅ | migración 0002, semilla |
| RLS en todas las tablas de `public` | ✅ | migración 0010 (con verificación automática) |
| Aislamiento de costos por base de datos | ✅ | tablas de costo con política de dueño |
| Auditoría base | ✅ | `audit_logs`, `app.audit()`, `/auditoria` |
| Datos demo identificables y borrables | ✅ | `is_demo`, `app.purge_demo_data()` |
| PWA instalable (manifest + iconos) | ✅ | `public/manifest.webmanifest` |
| CI de typecheck, lint y pruebas | ✅ | `.github/workflows/ci.yml` |

## Fase 1 — Núcleo operativo · ✅ con salvedades

| Requisito | Estado | Nota |
|---|---|---|
| Catálogo, variantes y atributos flexibles | ✅ | `/productos` es de solo lectura; el alta se hace por acción de servidor o semilla |
| Combos virtual y prearmado | ✅ | `assemble_bundle` / `disassemble_bundle` |
| Servicios no inventariables | ✅ | Grabado y Envío en la semilla |
| Listas de precio derivadas con redondeo | ✅ | `app.effective_price`, `src/lib/pricing.ts` |
| Costos: último y promedio ponderado | ✅ | `variant_costs`, `app.recalc_average_cost` |
| Stock: físico, reservado, disponible, dañado, exhibición | ✅ | `inventory_balances.state` |
| Lotes y asignación FIFO | ✅ | `app.stock_out` consume por antigüedad |
| Libro de movimientos completo | ✅ | 17 tipos en `app.movement_type` |
| Transferencias Salón ↔ Altillo | ✅ | `transfer_stock` |
| Ajuste manual con motivo (solo dueño) | ✅ | `adjust_stock` |
| Apertura de caja, sesión única | ✅ | índice único parcial + validación |
| Venta inmediata transaccional | ✅ | `create_instant_sale` |
| Pagos combinados, comisiones, vuelto | ✅ | criterios 12–14 |
| Descuento auditado por línea y por total | ✅ | `order_discounts` |
| Bloqueo de venta sin stock + excepción del dueño | ✅ | criterio 6 |
| Salida por venta online | ✅ | `online_sale_exit` |
| Cierre de caja con diferencias justificadas | ✅ | `close_cash_session` |
| Reapertura solo del dueño, conservando el cierre | ✅ | `reopen_cash_session`, `close_version` |
| Reversión de venta con contramovimientos | ✅ | `reverse_sale` |
| Comprobante imprimible A4 | ✅ | `/comprobante/[id]` |
| Plantilla XLSX de importación | ✅ | `npm run xlsx:template` |
| **Importación XLSX (subir, mapear, validar, aplicar)** | ⬜ | Las tablas `import_jobs` / `import_job_rows` existen; falta la pantalla y el procesamiento |
| **Exportación XLSX** | ⬜ | Pendiente |
| **Alta de producto desde la interfaz** | 🟡 | La acción `createProduct` existe y funciona; falta el formulario |
| **Actualización masiva de precios** | ⬜ | Previsto en fase 3 |
| **Inventario físico (conteo)** | 🟡 | Modelo completo (`inventory_counts`); falta la pantalla y la función de aprobación |

## Fase 2 — Pedidos y cumplimiento · ⬜

Modelo de datos completo y con RLS: `orders` con sus cuatro estados,
`stock_reservations`, `customer_account_entries`, `fulfillments`, `returns`,
`deliveries`, `manufacturing`/personalización.

Falta implementar: presupuestos, señas y reservas
(`reserve_order_stock`, `release_order_reservation`), entregas parciales
(`fulfill_order`), devoluciones (`process_return`), cuenta corriente de clientes
(`record_customer_payment`), encargos externos, personalizaciones, cobro por
fletero y sus pantallas.

## Fase 3 — Compras y proveedores · ⬜

Modelo completo: `suppliers`, `purchase_orders`, `goods_receipts`,
`supplier_account_entries`, `supplier_payments`, `supplier_incidents`.

Falta: `receive_purchase`, `record_supplier_payment`, actualización de costos al
recibir, comparación contra el costo anterior, cuentas por pagar y sus pantallas.

## Fase 4 — Decisiones y cartelería · 🟡

Implementado: `v_stock_aging` con tramos de antigüedad y valor inmovilizado;
`v_sale_margins` con contribución directa y comisión prorrateada;
`v_sales_daily`; y en `src/lib/metrics.ts` las fórmulas del capítulo 22 con sus
pruebas —ticket promedio, sell-through, rotación, cobertura, GMROI, conversión
de presupuestos, morosidad, ABC/Pareto, la regla honesta de «menos vendido» y
las recomendaciones de stock—, todas devolviendo «datos insuficientes» en lugar
de inventar.

Falta: el tablero completo del Centro de decisiones, los resúmenes diario y
mensual persistidos, la afinidad de compra, la pantalla de ventas perdidas
(la acción `recordLostSale` ya existe) y el generador de carteles.

## Fase 5 — Administración ampliada · ⬜

Modelo completo de asistencia, tareas, adelantos, comisiones y sueldos.
Facturación manual modelada en `manual_invoices`. Falta la interfaz
`FiscalProvider` para ARCA, la sincronización con ecommerce y las pantallas.

---

## Criterios de aceptación de la sección 31

| # | Criterio | Estado | Prueba |
|---|---|---|---|
| 1 | Vender dos unidades reduce el stock exacto | ✅ | `02_ventas_stock.sql` |
| 2 | Combo virtual reduce todos sus componentes | ✅ | `02_ventas_stock.sql` |
| 3 | Armar combo prearmado consume y aumenta | ✅ | `02_ventas_stock.sql` |
| 4 | Dos ventas concurrentes no consumen la misma unidad | ✅ | `concurrencia.sh` (dos conexiones reales) |
| 5 | Doble clic no duplica venta ni pago | ✅ | `02_ventas_stock.sql` |
| 6 | Producto sin stock bloqueado para el empleado | ✅ | `02_ventas_stock.sql` |
| 7 | Salida online baja stock sin ingreso en caja | ✅ | `02_ventas_stock.sql` |
| 8–11 | Señas, reservas y entregas parciales | ⬜ | fase 2 |
| 12 | Pago combinado suma exactamente el total | ✅ | `03_pagos_caja.sql` |
| 13 | Comisión por cada medio | ✅ | `03_pagos_caja.sql` |
| 14 | Efectivo afecta el cajón; transferencia no | ✅ | `03_pagos_caja.sql` |
| 15 | Cuenta corriente con saldos y vencimientos | 🟡 | modelo y venta a cuenta sí; gestión de cobros, fase 2 |
| 16 | No se abre una segunda sesión de caja | ✅ | `02_ventas_stock.sql` |
| 17 | Cierre muestra esperado y declarado por medio | ✅ | `03_pagos_caja.sql` |
| 18 | Diferencia exige motivo | ✅ | `03_pagos_caja.sql` |
| 19 | El empleado no puede reabrir | ✅ | `03_pagos_caja.sql` |
| 20 | Reapertura conserva cierre original y auditoría | ✅ | `03_pagos_caja.sql` |
| 21–24 | Compras, costos y pagos a proveedores | ⬜ | fase 3 |
| 25 | Devolución no borra la venta | ✅ | `04_reversion.sql` |
| 26 | Crea reversos de stock y dinero | ✅ | `04_reversion.sql` |
| 27 | Producto dañado no vuelve a disponible | 🟡 | el estado `damaged` existe; el flujo de devolución, fase 2 |
| 28 | El empleado no obtiene costos ni márgenes | ✅ | `01_permisos.sql` |
| 29 | Descuento del empleado auditado | ✅ | `03_pagos_caja.sql` |
| 30 | Cambio de precio/costo en historial | ✅ | `set_variant_price`, `set_variant_cost` |
| 31–36 | Reportes | 🟡 | vistas y fórmulas sí; pantallas, fase 4 |
| 37–40 | Carteles | ⬜ | fase 4 |

## Pruebas end-to-end

Las especificaciones de Playwright están escritas
(`tests/e2e/login.spec.ts`, `venta.spec.ts`, `stock-caja.spec.ts`) y cubren
ingreso y separación de roles, venta simple, doble clic, pago combinado,
descuento con motivo, atajos de teclado, transferencia, salida online y ciclo de
caja, en Chromium de escritorio, una vista móvil y WebKit para lo crítico.

**No se ejecutaron todavía**: necesitan una instancia de Supabase levantada, y
en el entorno donde se desarrolló esto la descarga de imágenes de Docker está
bloqueada por política de red. El recorrido equivalente sí se verifica de punta
a punta contra la base en `supabase/tests/05_dia_completo.sql`, que simula un
turno completo: apertura, venta en efectivo, venta combinada con descuento,
combo con servicio, transferencia, salida online, gasto, arqueo y cierre, más la
comprobación de que el empleado no ve el margen del día ni puede reabrir el turno.
