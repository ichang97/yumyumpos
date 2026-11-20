import { computed, ref } from 'vue';

const items = ref([]);

function buildItemKey(entry) {
  const notePart = (entry.note || '').trim();
  if (entry.is_custom) {
    return `custom:${entry.menu_name.trim()}:${Number(entry.base_price)}:${notePart}`;
  }
  const optionIds = (entry.selected_options || [])
    .map((o) => o.id)
    .sort((a, b) => a - b)
    .join(',');
  return `std:${entry.menu_id}:[${optionIds}]:${notePart}`;
}

export function useCart() {
  const itemCount = computed(() =>
    items.value.reduce((sum, item) => sum + item.quantity, 0)
  );

  const subtotal = computed(() => {
    const total = items.value.reduce((sum, item) => sum + item.unit_price * item.quantity, 0);
    return Math.round(total * 100) / 100;
  });

  function addItem(entry) {
    const selectedOptions = Array.isArray(entry.selected_options) ? entry.selected_options : [];
    const optionsPrice =
      Math.round(
        selectedOptions.reduce((sum, opt) => sum + Number(opt.price_delta || 0), 0) * 100
      ) / 100;
    const basePrice = Math.round(Number(entry.base_price || 0) * 100) / 100;
    const unitPrice = Math.round((basePrice + optionsPrice) * 100) / 100;
    const quantity = Math.max(1, Number(entry.quantity) || 1);
    const note = (entry.note || '').trim();

    const normalized = {
      is_custom: Boolean(entry.is_custom),
      menu_id: entry.is_custom ? null : entry.menu_id,
      menu_name: entry.menu_name,
      base_price: basePrice,
      selected_options: selectedOptions,
      options_price: optionsPrice,
      unit_price: unitPrice,
      quantity,
      note,
    };

    const key = buildItemKey(normalized);
    const existing = items.value.find((item) => item.key === key);
    if (existing) {
      existing.quantity += quantity;
      return;
    }

    items.value.push({
      key,
      ...normalized,
    });
  }

  function updateQuantity(key, delta) {
    const idx = items.value.findIndex((item) => item.key === key);
    if (idx === -1) {
      return;
    }
    const nextQty = items.value[idx].quantity + delta;
    if (nextQty <= 0) {
      items.value.splice(idx, 1);
      return;
    }
    items.value[idx].quantity = nextQty;
  }

  function removeItem(key) {
    const idx = items.value.findIndex((item) => item.key === key);
    if (idx !== -1) {
      items.value.splice(idx, 1);
    }
  }

  function clearCart() {
    items.value = [];
  }

  function buildOrderItemsPayload() {
    return items.value.map((item) => {
      if (item.is_custom) {
        return {
          is_custom: true,
          menu_name: item.menu_name,
          base_price: item.base_price,
          quantity: item.quantity,
          note: item.note || null,
        };
      }
      return {
        is_custom: false,
        menu_id: item.menu_id,
        option_ids: item.selected_options.map((opt) => opt.id),
        quantity: item.quantity,
        note: item.note || null,
      };
    });
  }

  return {
    items,
    itemCount,
    subtotal,
    addItem,
    updateQuantity,
    removeItem,
    clearCart,
    buildOrderItemsPayload,
  };
}
