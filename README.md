# Punto Madera

Sistema de gestión del local de Punto Madera: punto de venta, stock, caja,
pedidos, compras, entregas y decisiones comerciales.

No es solamente un punto de venta. La idea que ordena todo el diseño es que
**cada dato se cargue una sola vez** y alimente automáticamente stock, caja,
cuenta corriente, costos, rentabilidad, entregas, reportes, alertas y cartelería.

- Idioma: español (Argentina) · Moneda: ARS · Zona: America/Argentina/Buenos_Aires
- Uso principal en PC de mostrador; correcto en celular y tablet.

## Estado

Fases 0 y 1 de la especificación implementadas de punta a punta hasta la base de
datos. El modelo de datos de las fases 2 a 5 ya existe (con RLS) para no
rediseñar el núcleo más adelante.

El detalle honesto de qué funciona hoy y qué falta está en
[`ESTADO_REQUISITOS.md`](ESTADO_REQUISITOS.md). El plan por fases, en
[`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md). Las decisiones de
arquitectura y por qué se tomaron, en
[`DECISIONES_TECNICAS.md`](DECISIONES_TECNICAS.md).

## Arquitectura en una pantalla

```
Navegador (React)
      │  solo lectura + sesión
      ▼
Next.js App Router ── Server Actions ──┐
      │                                 │ RPC
      ▼                                 ▼
  Supabase Auth              Funciones PL/pgSQL SECURITY DEFINER
                                        │
                                        ▼
                              PostgreSQL + Row Level Security
```

Tres reglas sostienen todo lo demás:

1. **La base es la autoridad.** Stock, caja, saldos y cuentas se modelan como
   libros de movimientos y solo los modifican funciones transaccionales. La
   interfaz no puede escribirlos ni por error ni a propósito.
2. **Los costos se aíslan en tablas propias.** La RLS es por fila, no por
   columna; poner los costos en `variant_costs`, `cost_history`,
   `inventory_lots` y `order_item_costs` con política de solo dueño es lo que
   hace que el empleado no pueda leerlos ni consultando la API directamente.
3. **Nada confirmado se borra.** Las correcciones son reversos o ajustes con
   motivo, y todo queda auditado.

> **¿Primera vez?** Seguí [`PRIMEROS_PASOS.md`](PRIMEROS_PASOS.md): es la guía
> paso a paso, desde instalar Node hasta la primera venta de prueba.

## Puesta en marcha

Requisitos: Node 22+, Docker (para Supabase local) o PostgreSQL 15+.

```bash
npm install
cp .env.example .env.local
```

### Opción A — Supabase local (recomendada)

```bash
npx supabase start          # imprime la URL y la clave anónima
# copiá esos dos valores a .env.local
npx supabase db reset       # aplica migraciones + semilla
npm run dev
```

### Opción B — PostgreSQL local, sin Docker

Sirve para trabajar sobre el esquema, las funciones y sus pruebas sin levantar
todo el stack. La aplicación web necesita la opción A.

```bash
npm run db:reset            # recrea la base, migra y siembra
npm run db:test             # corre las pruebas de base de datos
```

### Usuarios demo

| Rol      | Correo                      | Contraseña           |
|----------|-----------------------------|----------------------|
| Dueño    | `dueno@puntomadera.test`    | `punto-madera-demo`  |
| Empleado | `empleado@puntomadera.test` | `punto-madera-demo`  |

Sirven para comprobar la separación de permisos. **Borralos antes de producción**
junto con el resto de los datos demo:

```sql
select app.purge_demo_data();
```

## Comandos

| Comando                | Qué hace                                              |
|------------------------|-------------------------------------------------------|
| `npm run dev`          | Servidor de desarrollo                                |
| `npm run build`        | Build de producción                                   |
| `npm run typecheck`    | TypeScript estricto                                   |
| `npm run lint`         | ESLint                                                |
| `npm test`             | Pruebas unitarias (dinero, precios, indicadores)      |
| `npm run test:e2e`     | Playwright (necesita Supabase levantado)              |
| `npm run db:reset`     | Recrea la base local, migra y siembra                 |
| `npm run db:test`      | Pruebas de RLS, funciones, concurrencia e idempotencia|
| `npm run xlsx:template`| Regenera la plantilla de importación                  |

## Importar y exportar

**Importar catálogo**: *Importar y exportar* → descargar la plantilla XLSX,
completarla y subirla. El sistema previsualiza, valida fila por fila y deja
descargar los errores en CSV. Se aplican solo las filas válidas; un SKU que ya
existe **no se sobrescribe**, se informa y se omite. El lote se puede revertir
mientras sus productos no hayan tenido movimientos posteriores.

**Exportar**: `catalogo`, `stock`, `movimientos`, `ventas`, `caja` y
`rentabilidad` (esta última solo para el dueño). Las consultas se hacen con la
sesión de quien descarga, así que la exportación no puede convertirse en la
puerta trasera por la que el empleado se lleva los costos.

## Cómo está organizado

```
src/
  app/
    (app)/            pantallas con sesión iniciada
    ingresar/         inicio de sesión
  components/         interfaz compartida
  lib/                dinero, formato es-AR, precios, indicadores, permisos
  server/
    session.ts        contexto del usuario
    actions/          Server Actions: único camino de escritura
supabase/
  migrations/         esquema versionado (0001…0015)
  seed.sql            datos demo identificables y borrables
  tests/              pruebas de base de datos
tests/
  unit/               pruebas unitarias
  e2e/                pruebas end-to-end
```

## Atajos del punto de venta

| Tecla        | Acción                  |
|--------------|-------------------------|
| `F4`         | Enfocar el buscador     |
| `Ctrl/⌘ + K` | Búsqueda global         |
| `F8`         | Abrir el cobro          |
| `Esc`        | Cerrar el cobro         |

## Documentación

- [`PRIMEROS_PASOS.md`](PRIMEROS_PASOS.md) — cómo hacerlo andar, paso a paso
- [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) — fases, tareas y criterios de cierre
- [`ESTADO_REQUISITOS.md`](ESTADO_REQUISITOS.md) — qué está implementado y qué no
- [`DECISIONES_TECNICAS.md`](DECISIONES_TECNICAS.md) — decisiones y sus motivos
- [`MANUAL_OPERACION.md`](MANUAL_OPERACION.md) — cómo se usa en el mostrador
- [`DESPLIEGUE.md`](DESPLIEGUE.md) — puesta en producción y checklist de salida
