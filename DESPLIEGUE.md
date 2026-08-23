# Guía de despliegue

Aplicación en Vercel, base y autenticación en Supabase.

---

## 1. Crear el proyecto en Supabase

1. Crear un proyecto nuevo en [supabase.com](https://supabase.com).
2. Elegir la región más cercana (São Paulo para Argentina).
3. Guardar la contraseña de la base en un lugar seguro: no se puede recuperar.
4. Anotar de **Project Settings → API**:
   - `Project URL` → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

> La clave `service_role` elude la RLS por completo. Nunca lleva el prefijo
> `NEXT_PUBLIC_`, nunca se usa desde el navegador y nunca se versiona.

## 2. Aplicar las migraciones

```bash
npx supabase link --project-ref <ref-del-proyecto>
npx supabase db push
```

Verificar que las 15 migraciones se aplicaron y que la verificación de RLS del
final de `0010_rls.sql` no falló.

**Con datos demo** (para probar antes de abrir):

```bash
npx supabase db push --include-seed
```

**Sin datos demo** (producción real): no incluir la semilla y crear a mano la
organización, la sucursal, las ubicaciones, los medios de pago y las listas de
precio. La semilla sirve de referencia de qué hay que crear.

## 3. Crear los usuarios reales

En **Authentication → Users**, crear el dueño y el empleado con contraseñas
seguras. Después, por cada uno:

```sql
insert into user_profiles (id, organization_id, branch_id, full_name, role, email)
values ('<uuid-de-auth>', '<uuid-organizacion>', '<uuid-sucursal>',
        'Nombre Apellido', 'owner', 'correo@dominio');
```

Los permisos del empleado se cargan en `role_permissions`; la semilla tiene el
conjunto de la sección 5.2 de la especificación como punto de partida.

**El registro público está deshabilitado** (`enable_signup = false`): los
usuarios los crea el dueño.

## 4. Desplegar en Vercel

1. Conectar el repositorio.
2. Framework: Next.js (se detecta solo).
3. Variables de entorno (**Production** y **Preview**):

| Variable | Valor |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | URL del proyecto |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | clave anónima |
| `SUPABASE_SERVICE_ROLE_KEY` | clave de servicio (solo si hace falta para tareas administrativas) |

4. Desplegar.
5. En Supabase → **Authentication → URL Configuration**, poner el dominio de
   Vercel en `Site URL` y en `Redirect URLs`.

## 5. Dominio propio

En Vercel → **Settings → Domains**, agregar el dominio y seguir las
instrucciones de DNS. Actualizar después el `Site URL` de Supabase.

---

## Checklist de salida a producción

Corresponde a la sección 36 de la especificación.

### Datos
- [ ] Usuarios reales creados, con contraseñas seguras
- [ ] Datos demo eliminados: `select app.purge_demo_data();`
- [ ] Productos importados o cargados
- [ ] Inventario inicial contado y cargado con movimientos reales
- [ ] Costos y listas de precio revisados
- [ ] Medios de pago y comisiones configurados con los valores reales
- [ ] Caja inicial creada

### Textos y marca
- [ ] Políticas comerciales cargadas en `business_settings` (cambios, señas,
      retiro, aviso sobre la madera)
- [ ] Logo y colores cargados en `brand_settings`
- [ ] Comprobante probado en A4 con impresora real

### Seguridad
- [ ] RLS verificada: entrar como empleado y comprobar que no accede a costos
- [ ] `service_role` fuera del navegador y fuera del repositorio
- [ ] Backups automáticos habilitados en Supabase
- [ ] Prueba de restauración documentada (restaurar en un proyecto de prueba y
      verificar que los datos están)

### Prueba funcional completa
- [ ] Abrir caja
- [ ] Venta completa con pago combinado
- [ ] Venta con descuento y su motivo
- [ ] Salida por venta online
- [ ] Transferencia entre Salón y Altillo
- [ ] Cierre de caja con diferencia justificada
- [ ] Reapertura por el dueño y verificación de que el cierre original quedó
- [ ] Permisos del empleado verificados uno por uno

---

## Respaldo y recuperación

Supabase hace backups diarios automáticos. Además conviene exportar
periódicamente:

```bash
npx supabase db dump -f respaldo-$(date +%F).sql --data-only
```

Guardar la copia fuera de Supabase. Un backup que nunca se probó no es un
backup: restaurarlo en un proyecto de prueba al menos una vez, y anotar cuánto
tardó y qué hizo falta.

## Mantenimiento

- **Nueva migración**: crear `supabase/migrations/00NN_descripcion.sql`, probar
  con `npm run db:reset && npm run db:test`, y recién ahí `npx supabase db push`.
- **Nunca editar una migración ya aplicada en producción.** Agregar una nueva.
- **Antes de cada despliegue**: `npm run typecheck && npm run lint && npm test`.
