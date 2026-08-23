# Cómo hacerlo andar — paso a paso

Guía para levantar Punto Madera desde cero. Calculá **30 a 45 minutos** la
primera vez.

Hay dos caminos. Elegí uno:

- **Camino A — Supabase en la nube.** No necesita Docker. Es el más simple y el
  que además te deja el sistema andando desde cualquier computadora del local.
  **Es el que te recomiendo.**
- **Camino B — Todo en tu computadora.** Necesita Docker. Sirve para probar sin
  crear ninguna cuenta.

---

# Camino A — Supabase en la nube (recomendado)

## Paso 1 · Instalar Node.js

Node es lo que hace funcionar la aplicación.

1. Entrá a **https://nodejs.org** y descargá la versión **LTS**.
2. Instalala con las opciones por defecto.
3. Abrí una terminal (en Windows: *PowerShell*; en Mac: *Terminal*) y verificá:

```bash
node --version
```

Tiene que decir `v20` o más. Si dice «no se reconoce el comando», cerrá la
terminal, abrila de nuevo y probá otra vez.

## Paso 2 · Bajar el código

```bash
git clone https://github.com/tomicast28-cpu/Pm.git punto-madera
cd punto-madera
git checkout claude/punto-madera-sistema-a6nj1l
npm install
```

El `npm install` tarda un par de minutos la primera vez.

> Si no tenés `git`, descargalo de **https://git-scm.com/downloads**.

## Paso 3 · Crear el proyecto en Supabase

Supabase es la base de datos. El plan gratuito alcanza de sobra para un local.

1. Entrá a **https://supabase.com** y creá una cuenta.
2. **New project**.
   - **Name**: `punto-madera`
   - **Database Password**: generá una y **guardala** donde no se pierda; no se
     puede recuperar después.
   - **Region**: `South America (São Paulo)` — es la más cercana.
3. Esperá dos o tres minutos a que termine de crearse.

## Paso 4 · Subir la base de datos

En la terminal, dentro de la carpeta del proyecto:

```bash
npx supabase login
```

Se abre el navegador para que autorices. Después:

```bash
npx supabase link --project-ref TU_REFERENCIA
```

> **Dónde sale `TU_REFERENCIA`**: en Supabase, *Project Settings → General →
> Reference ID*. Es una cadena tipo `abcdefghijklmnop`. Te va a pedir la
> contraseña de la base que guardaste en el paso 3.

Ahora subí el esquema:

```bash
npx supabase db push
```

Tiene que aplicar las 16 migraciones sin errores.

**Si querés arrancar con productos de ejemplo** (recomendado para probar):

1. En Supabase, abrí **SQL Editor → New query**.
2. Abrí el archivo `supabase/seed.sql` del proyecto, copiá **todo** el contenido
   y pegalo ahí.
3. **Run**.

Esto crea las categorías, los medios de pago, las listas de precio, la caja, un
proveedor, clientes y productos de ejemplo con stock. Todo queda marcado como
demo y se borra después con un solo comando.

## Paso 5 · Crear los usuarios

Los usuarios se crean desde el panel, así Supabase les asigna la contraseña
correctamente.

1. En Supabase, andá a **Authentication → Users → Add user → Create new user**.
2. Creá el **dueño**:
   - Email: el tuyo, por ejemplo `dueno@puntomadera.com`
   - Password: una contraseña segura
   - **Marcá `Auto Confirm User`** (importante, si no no va a poder entrar)
3. Repetí para el **empleado**.

Ahora hay que decirle al sistema quién es quién:

1. **SQL Editor → New query**.
2. Copiá y pegá todo el contenido del archivo
   `supabase/scripts/vincular-usuario.sql` y dale **Run**.
3. En una consulta nueva, ejecutá (cambiando los correos por los tuyos):

```sql
select app.vincular_usuario('dueno@puntomadera.com',    'owner',    'Tu Nombre');
select app.vincular_usuario('empleado@puntomadera.com', 'employee', 'Nombre del Empleado');
```

Cada línea te responde `Listo: ... quedó vinculado como dueño`. Si te dice que
no existe el usuario, es que faltó crearlo en el paso anterior o no marcaste
*Auto Confirm*.

## Paso 6 · Conectar la aplicación con la base

1. En Supabase: **Project Settings → API**. Vas a ver dos datos:
   - **Project URL**
   - **anon public** (una cadena larga)
2. En la carpeta del proyecto, copiá el archivo de ejemplo:

```bash
cp .env.example .env.local
```

3. Abrí `.env.local` con cualquier editor de texto y completá las dos primeras
   líneas:

```
NEXT_PUBLIC_SUPABASE_URL=https://abcdefghijklmnop.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJhbGciOi...
```

> La clave `anon` es pública por diseño: no da acceso a nada por sí sola, porque
> la seguridad la aplica la base de datos. **La clave `service_role` no va acá
> ni en ningún lado del navegador.**

## Paso 7 · Arrancar

```bash
npm run dev
```

Abrí **http://localhost:3000** en el navegador. Entrá con el correo y la
contraseña del dueño.

**Listo.** Ya podés operar.

## Paso 8 · Probar que anda bien

Hacé este recorrido, que es el de un día de local:

1. **Caja → Abrir caja** → poné `10000` de efectivo inicial.
2. **Nueva venta** → escribí `tabla` → clic en el producto → **Cobrar** →
   **Confirmar venta**.
3. Abrí el comprobante y probá **Imprimir**.
4. **Stock** → fijate que la tabla bajó una unidad.
5. Cerrá sesión y entrá **con el usuario empleado**. Fijate que:
   - no aparece *Reportes*, *Auditoría* ni *Configuración*;
   - en *Productos* no hay columnas de costo ni margen;
   - en el inicio no aparece el margen del día.
6. Volvé a entrar como dueño → **Caja → Cerrar caja**.

Si los seis pasos funcionan, está andando correctamente.

---

# Camino B — Todo en tu computadora (con Docker)

Sirve para probar sin crear cuentas. No queda accesible desde otra computadora.

1. Instalá **Node.js** (paso 1 del camino A) y **Docker Desktop**
   (https://www.docker.com/products/docker-desktop). Abrí Docker Desktop y
   esperá a que diga *Running*.
2. Bajá el código (paso 2 del camino A).
3. Levantá Supabase local:

```bash
npx supabase start
```

La primera vez descarga bastante y puede tardar 10 minutos. Al terminar imprime
una lista de datos. Copiá **API URL** y **anon key**.

4. Creá `.env.local` con esos dos valores (paso 6 del camino A).
5. Cargá la base con datos de ejemplo:

```bash
npx supabase db reset
```

6. Arrancá:

```bash
npm run dev
```

En este camino los usuarios demo de la semilla **sí** funcionan directamente:

| Rol      | Correo                      | Contraseña          |
|----------|-----------------------------|---------------------|
| Dueño    | `dueno@puntomadera.test`    | `punto-madera-demo` |
| Empleado | `empleado@puntomadera.test` | `punto-madera-demo` |

---

# Poner el sistema en internet

Mientras uses `npm run dev`, el sistema anda solo en esa computadora y solo
mientras la terminal esté abierta. Para que ande siempre y desde cualquier lado:

1. Creá una cuenta en **https://vercel.com** (el plan gratuito alcanza).
2. **Add New → Project** → importá el repositorio de GitHub.
3. En **Environment Variables**, cargá las mismas dos del paso 6:
   `NEXT_PUBLIC_SUPABASE_URL` y `NEXT_PUBLIC_SUPABASE_ANON_KEY`.
4. **Deploy**. En un minuto te da una dirección tipo
   `punto-madera.vercel.app`.
5. Volvé a Supabase → **Authentication → URL Configuration** y poné esa
   dirección en **Site URL** y en **Redirect URLs**.

Desde ahí entrás desde la computadora del mostrador, el celular o la tablet.
En el celular, el navegador te va a ofrecer *Agregar a pantalla de inicio*: se
instala como una aplicación.

---

# Antes de usarlo en serio

Cuando termines de probar y quieras empezar a cargar datos reales:

1. **Borrá los datos de ejemplo.** En el SQL Editor de Supabase:

```sql
select app.purge_demo_data();
```

   Esto borra la organización demo entera: productos, movimientos y ventas de
   prueba. **Ojo: si ya cargaste datos reales sobre la organización demo, no lo
   corras** — borraría todo.

2. Seguí el checklist completo de `DESPLIEGUE.md`: cargar productos reales,
   contar el inventario inicial, revisar costos y listas, configurar los medios
   de pago con tus comisiones reales, cargar logo y textos del comprobante, y
   probar la impresión en A4.

---

# Si algo no funciona

**«Falta la variable de entorno NEXT_PUBLIC_SUPABASE_URL»**
El archivo `.env.local` no existe o está mal escrito. Tiene que estar en la
carpeta principal del proyecto (al lado de `package.json`), y después de
editarlo hay que cortar el servidor (`Ctrl+C`) y volver a correr `npm run dev`.

**«Correo o contraseña incorrectos» aunque estén bien**
Casi siempre es que al crear el usuario no marcaste *Auto Confirm User*. Entrá a
**Authentication → Users**, borralo y crealo de nuevo con esa opción marcada.

**Entro pero me saca a la pantalla de ingreso todo el tiempo**
Falta vincular el usuario. Volvé al paso 5 y corré `app.vincular_usuario` con
tu correo.

**«No hay una caja abierta. Abrí la caja antes de cobrar.»**
No es un error: el sistema no deja cobrar sin caja abierta, para que el arqueo
cierre. Andá a **Caja → Abrir caja**.

**El empleado no ve algo que debería ver**
Los permisos están en la tabla `role_permissions`. Podés verlos en
*Configuración* o cambiarlos desde el SQL Editor.

**«permission denied for schema auth» al correr el script del paso 5**
Si te pasa, el archivo `supabase/scripts/vincular-usuario.sql` que tenés es una
versión vieja que intentaba crear una función dentro del esquema `auth`, algo
que Supabase no permite ni al rol `postgres`. Actualizá el código con
`git pull` y volvé a copiar el archivo. La versión corregida solo **lee**
`auth.users`, que sí está permitido.

**`npm install` falla**
Suele ser una versión vieja de Node. Verificá con `node --version` que diga
`v20` o más.
