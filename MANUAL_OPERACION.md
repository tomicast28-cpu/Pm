# Manual breve de operación

Para quien atiende el mostrador. Cuatro páginas, no cuarenta.

---

## Un día de local, en orden

### 1. Entrar y abrir la caja

Ingresá con tu correo y contraseña. Lo primero que ves es tu día: ventas,
pedidos, retiros y faltantes.

Andá a **Caja → Abrir caja**, contá el efectivo que hay en el cajón y escribí
ese número. **Hasta que la caja no esté abierta no se puede cobrar.**

### 2. Vender

**Nueva venta** (o `F4` para saltar directo al buscador).

1. Escribí parte del nombre, el SKU o la categoría. No hace falta la palabra
   completa: «canas neg» encuentra el canasto negro.
2. Hacé clic en el producto para agregarlo. Cada clic suma una unidad.
3. Ajustá cantidades con `−` y `+`.
4. Si hacés un descuento, escribí el importe **y el motivo**. Queda registrado
   con tu nombre; no es un control sobre vos, es lo que después permite entender
   por qué un producto rindió menos.
5. `F8` abre el cobro.

**Cobrar con más de un medio**: cargá el primer importe, tocá *Agregar otro
medio de pago* y el sistema propone el resto. Abajo siempre ves *Total*,
*Cobrado* y *Falta* (o *Vuelto*, si el cliente pagó de más en efectivo).

**Si hacés clic dos veces en Confirmar, la venta se registra una sola vez.**
No la vas a duplicar aunque se trabe la conexión.

Al confirmar tenés el enlace al comprobante para imprimir en A4.

### 3. Si el producto no tiene stock

El sistema no te deja venderlo. No es un error: si el stock dice cero y el
producto está en el salón, la diferencia hay que resolverla, no esquivarla.
Avisale al dueño, que puede autorizar la excepción dejando el motivo.

### 4. Mover mercadería entre Salón y Altillo

**Stock → Transferir entre ubicaciones.** Elegí producto, desde dónde, hacia
dónde y cuánto.

Nunca corrijas cantidades a mano: la transferencia deja el rastro de dónde está
físicamente cada unidad, y una corrección manual lo borra.

### 5. Si vendiste por Instagram, WhatsApp o Mercado Libre

Depende de cómo se cobró:

- **Se cobró en el local o lo cobrás vos** → es una venta normal. Elegí el canal
  en *Nueva venta*.
- **Se cobró afuera** (Mercado Libre, Tiendanube) → **Stock → Salida por venta
  online**. Descuenta el stock sin sumar plata a la caja, así el arqueo cierra y
  los ingresos no se cuentan dos veces.

### 6. Gastos y retiros del día

**Caja → Ingreso, retiro o gasto.** Anotá todo lo que salió del cajón durante el
turno. Si no queda registrado, aparece como faltante al cerrar.

### 7. Cerrar la caja

**Caja → Cierre de caja.** El sistema muestra lo que espera por cada medio de
pago. Contá lo que hay realmente y escribilo.

Si hay diferencia, el sistema pide el motivo y **no cierra sin él**. Escribí lo
que sepas, aunque sea «falta y no sé por qué»: esa frase repetida tres veces en
un mes es información.

---

## Preguntas que aparecen seguido

**Me equivoqué en una venta ya cobrada.**
Solo el dueño puede revertirla, y deja constancia del motivo. La venta no se
borra nunca: queda marcada como anulada y se generan los movimientos inversos de
stock y de dinero. Si la caja de esa venta ya se cerró, hay que reabrirla primero.

**Cerré la caja antes de tiempo.**
El dueño puede reabrirla explicando por qué. El cierre original se conserva: la
reapertura no lo borra, agrega una versión nueva.

**¿Por qué no veo los costos ni la ganancia?**
Esa información es del dueño. No es que la pantalla la esconda: la base de datos
directamente no te la entrega.

**Un cliente se llevó algo y paga después.**
Necesita estar cargado como cliente con cuenta corriente habilitada. A un
«Consumidor final» sin datos no se le puede fiar, porque no habría a quién
reclamarle.

**Vendí un combo, ¿qué pasa con las piezas?**
Si es un **combo virtual**, se descuentan las piezas. Si es un **combo
prearmado**, se descuenta el combo, porque sus piezas ya se consumieron cuando
se armó. En los dos casos el stock queda bien: no vas a vender dos veces la
misma tabla.

**Alguien preguntó por algo que no teníamos.**
Registralo: es la única forma de saber qué se está perdiendo por no reponer.
Tres consultas sin stock del mismo producto se convierten en una sugerencia de
compra.

---

## Atajos

| Tecla        | Acción              |
|--------------|---------------------|
| `F4`         | Buscador de producto|
| `Ctrl/⌘ + K` | Búsqueda global     |
| `F8`         | Abrir el cobro      |
| `Esc`        | Cerrar el cobro     |

---

## Lo que nunca hay que hacer

- **Corregir stock a mano** en lugar de transferir o ajustar con motivo. Se
  pierde el rastro de dónde estaba la mercadería.
- **Cerrar la caja poniendo el número que el sistema espera** cuando el cajón
  dice otra cosa. La diferencia justificada es información; la diferencia tapada
  es un problema que vuelve más grande.
- **Cobrar sin abrir la caja.** El sistema no lo permite, y por eso el arqueo
  cierra.
