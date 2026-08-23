# Registro de decisiones técnicas

Cada entrada dice qué se decidió, por qué, y qué se resignó al decidirlo.

---

## 1. La base de datos es la autoridad, no la aplicación

**Decisión.** Stock, caja, pagos, cuentas y descuentos solo se modifican desde
funciones PL/pgSQL `SECURITY DEFINER`. Las tablas de libro contable no tienen
políticas de escritura en RLS, así que un `insert` o `update` directo desde el
navegador —aun con una clave anónima válida y una sesión legítima— no encuentra
política que lo permita y es rechazado.

**Por qué.** La especificación pide que no exista ninguna escritura directa
desde el navegador capaz de eludir permisos o reglas de negocio. Validar en la
interfaz no alcanza: la API de PostgREST queda expuesta igual. Poner la regla en
el único lugar por el que pasan todos los caminos es lo que la hace cierta.

**Qué se resigna.** Escribir SQL para cada operación en vez de un ORM cómodo, y
que las reglas vivan en dos lenguajes (PL/pgSQL y TypeScript). A cambio, ninguna
ruta alternativa las saltea.

---

## 2. Los costos viven en tablas separadas

**Decisión.** `variant_costs`, `cost_history`, `inventory_lots` y
`order_item_costs` son tablas propias con política `app.is_owner()`. El costo no
es una columna de `product_variants` ni de `order_items`.

**Por qué.** Row Level Security filtra filas, no columnas. Si el costo fuera una
columna de `product_variants`, cualquier empleado que pueda leer el catálogo
—y necesita leerlo para vender— leería también el costo con un `select *`. La
única forma de que el criterio de aceptación 28 sea verdad a nivel de base es
que las filas de costo sean filas distintas.

**Qué se resigna.** Un `join` extra cada vez que el dueño quiere ver margen.
Es un precio bajo por una garantía estructural en lugar de una promesa de la
interfaz.

**Verificado en.** `supabase/tests/01_permisos.sql`: el empleado obtiene cero
filas de cada tabla de costo y de las vistas que las usan.

---

## 3. Dinero en centavos enteros, nunca en coma flotante

**Decisión.** `numeric(14,2)` en PostgreSQL; en TypeScript, la clase `Money`
opera sobre `bigint` de centavos y viaja como string decimal.

**Por qué.** `0.1 + 0.2 !== 0.3` en punto flotante. En una caja eso se convierte
en diferencias de centavos que nadie sabe explicar y que erosionan la confianza
en todo el sistema.

**Qué se resigna.** No se puede escribir `precio * cantidad` sin pensar. A
cambio, el arqueo cierra.

**Verificado en.** `tests/unit/money.test.ts`.

---

## 4. Las vistas se crean con `security_invoker = true`

**Decisión.** Todas las vistas (`v_pos_catalog`, `v_sale_margins`,
`v_stock_aging`, …) declaran `security_invoker`.

**Por qué.** Por omisión una vista de PostgreSQL se evalúa con los permisos de
quien la creó, no de quien la consulta: sería un túnel por debajo de la RLS.
Una vista de márgenes creada por el administrador le habría mostrado los costos
al empleado, anulando la decisión 2.

---

## 5. Idempotencia por clave, no por bloqueo de botón

**Decisión.** `orders.idempotency_key` y `payments.idempotency_key` tienen
índice único parcial. La clave se genera **una vez** al abrir el cobro y se
reenvía en cada intento. Si la venta ya existe, la función devuelve la existente
con `duplicate: true` en lugar de crear otra.

**Por qué.** Deshabilitar el botón mientras se envía protege contra el doble
clic, pero no contra un reintento de red, una pestaña duplicada o un `F5` en el
momento justo. La garantía tiene que estar del lado del servidor.

**Verificado en.** `supabase/tests/02_ventas_stock.sql`, criterio 5.

---

## 6. Concurrencia por bloqueo de fila, no por comprobación previa

**Decisión.** `app.lock_balance` hace `select … for update` sobre la fila de
saldo antes de validar y descontar.

**Por qué.** Un `select` que comprueba disponibilidad y un `update` posterior
dejan una ventana en la que dos ventas leen «queda 1» y ambas descuentan. El
bloqueo hace que la segunda transacción espere y vuelva a leer el valor ya
confirmado, y entonces falle correctamente por falta de stock.

**Verificado en.** `supabase/tests/concurrencia.sh`, con dos conexiones reales
compitiendo por la última unidad (criterio 4).

---

## 7. Combos: dos modos, no uno

**Decisión.** `bundle_virtual` no tiene stock propio; su disponibilidad es el
mínimo que permiten sus piezas y al venderse descuenta cada componente.
`bundle_stocked` sí tiene stock propio, que se crea con `assemble_bundle`
consumiendo componentes.

**Por qué.** Si un combo prearmado no consumiera sus piezas, un canasto ya
comprometido en un combo seguiría apareciendo como disponible por separado y se
vendería dos veces.

---

## 8. Los estados no se deducen unos de otros

**Decisión.** `orders` tiene cuatro campos independientes: `status`,
`payment_status`, `preparation_status` y `fulfillment_status`.

**Por qué.** Un pedido puede estar pagado pero pendiente de fabricar, o
entregado en parte con saldo pendiente. Derivar un estado del otro obliga a
inventar estados combinados que se multiplican y nunca alcanzan.

---

## 9. Salida por venta online separada de la venta

**Decisión.** `online_sale_exit` es una operación propia: descuenta stock,
registra canal y referencia, y **no** crea pedido ni movimiento de caja.

**Por qué.** La venta ya se cobró afuera. Registrarla como venta duplicaría los
ingresos y ensuciaría todos los indicadores. Registrarla como ajuste de stock
perdería la trazabilidad de por qué salió esa unidad.

---

## 10. Interfaz hecha a mano en lugar de una biblioteca de componentes

**Decisión.** Componentes propios sobre Tailwind, sin shadcn/ui ni Radix.

**Por qué.** El punto de venta necesita muy pocos componentes (botón, campo,
tarjeta, tabla, modal) y mucha velocidad de teclado. Una biblioteca completa
agrega peso y una capa de indirección para resolver un problema que acá es
chico. La regla de la especificación —no adoptar una dependencia cuando una
implementación simple cubre el caso— apunta a esto.

**Qué se resigna.** Hay que cuidar la accesibilidad a mano: roles, `aria-label`,
foco visible y navegación por teclado están puestos explícitamente.

---

## 11. Las secciones pendientes se muestran como pendientes

**Decisión.** Las pantallas de las fases 2 a 5 muestran su alcance previsto y la
fase en la que llegan, en lugar de datos de ejemplo.

**Por qué.** La especificación es explícita: una pantalla no está terminada si
solo muestra datos simulados. Mostrar un tablero lleno de números inventados es
peor que no mostrarlo, porque alguien podría tomar una decisión con eso.

---

## 12. `app.next_document_number` numera con `update … returning`

**Decisión.** Los números de comprobante salen de `document_sequences` mediante
un `update … returning` en lugar de una secuencia de PostgreSQL.

**Por qué.** Las secuencias no vuelven atrás si la transacción falla, y dejan
huecos en la numeración de comprobantes. El `update` bloquea la fila: dos ventas
concurrentes nunca reciben el mismo número, y una venta que falla no consume uno.

**Qué se resigna.** Contención si hubiera muchísimas ventas por segundo. Para un
local no es un problema.

---

## 13. Base local sin Docker para el esquema y sus pruebas

**Decisión.** `scripts/db-local.sh` aplica las migraciones y la semilla sobre
una PostgreSQL común. Las migraciones crean condicionalmente el esquema `auth`,
los roles de Supabase y `auth.uid()` si no existen.

**Por qué.** Permite ejercitar RLS, funciones transaccionales y concurrencia en
CI sin levantar todo el stack de Supabase, que es lento y pesado. La aplicación
web sigue necesitando Supabase; el esquema, no.
