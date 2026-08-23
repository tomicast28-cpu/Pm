/** Tipos compartidos del dominio. Espejan el esquema de la base. */

export type ProductKind = 'simple' | 'variant' | 'service' | 'bundle_virtual' | 'bundle_stocked';

export type PosCatalogItem = {
  variant_id: string;
  sku: string;
  barcode: string | null;
  product_id: string;
  product_name: string;
  variant_name: string;
  display_name: string;
  search_text: string;
  kind: ProductKind;
  category_id: string | null;
  category_name: string | null;
  brand: string | null;
  tags: string[];
  is_inventoried: boolean;
  visible_in_pos: boolean;
  attributes: Record<string, string>;
  unit: string;
  min_stock: string;
  is_active: boolean;
  available_qty: string;
  on_hand_qty: string;
  reserved_qty: string;
  image_path: string | null;
};

export type PaymentMethod = {
  id: string;
  code: string;
  name: string;
  affects_cash_drawer: boolean;
  requires_confirmation: boolean;
  commission_rate: string;
  commission_fixed: string;
  settlement_days: number;
  surcharge_rate: string;
  allows_change: boolean;
  is_account_credit: boolean;
  sort_order: number;
};

export type PriceList = {
  id: string;
  code: string;
  name: string;
  adjustment_rate: string;
  is_default: boolean;
  is_wholesale: boolean;
  sort_order: number;
};

export type StockLocation = {
  id: string;
  code: string;
  name: string;
  sellable: boolean;
  is_default: boolean;
  sort_order: number;
};

export type CartLine = {
  key: string;
  variantId: string;
  sku: string;
  displayName: string;
  kind: ProductKind;
  isInventoried: boolean;
  unitListPrice: string;
  quantity: number;
  discountAmount: string;
  discountReason: string;
  locationId: string | null;
  availableQty: string;
};

export type CartPayment = {
  key: string;
  paymentMethodId: string;
  amount: string;
  installments: number;
  reference: string;
};

/** Lo que devuelve `create_instant_sale`. */
export type SaleResult = {
  order_id: string;
  number: string;
  subtotal: string;
  discount_total: string;
  shipping_total: string;
  tax_total: string;
  total: string;
  paid_total: string;
  change: string;
  payment_status: string;
  duplicate: boolean;
};
