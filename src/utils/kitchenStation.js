export function itemMatchesStation(item, stationKey) {
  if (!stationKey || stationKey === 'all') {
    return true;
  }
  if (stationKey === 'custom') {
    return item.category_id === null || item.category_id === undefined;
  }
  return Number(item.category_id) === Number(stationKey);
}

export function deriveStationKitchenStatus(items) {
  const active = (Array.isArray(items) ? items : [])
    .map((i) => i.kitchen_status || 'pending')
    .filter((s) => s !== 'cancelled');
  if (active.length === 0) {
    return 'completed';
  }
  if (active.every((s) => s === 'completed')) {
    return 'completed';
  }
  if (active.every((s) => s === 'ready' || s === 'completed')) {
    return 'ready';
  }
  if (active.some((s) => s === 'cooking' || s === 'ready' || s === 'completed')) {
    return 'cooking';
  }
  return 'pending';
}

export function buildStationOrders(orders, stationKey) {
  const list = Array.isArray(orders) ? orders : [];
  if (!stationKey || stationKey === 'all') {
    return list.filter((o) => ['pending', 'cooking', 'ready'].includes(o.kitchen_status));
  }

  const result = [];
  for (const order of list) {
    const allItems = Array.isArray(order.items) ? order.items : [];
    const matchedItems = allItems.filter((item) => itemMatchesStation(item, stationKey));
    if (matchedItems.length === 0) {
      continue;
    }
    const stationStatus = deriveStationKitchenStatus(matchedItems);
    if (!['pending', 'cooking', 'ready'].includes(stationStatus)) {
      continue;
    }
    result.push({
      ...order,
      items: matchedItems,
      kitchen_status: stationStatus,
      total_item_count: allItems.length,
    });
  }
  return result;
}

export function countActiveByStation(orders, stationKey) {
  return buildStationOrders(orders, stationKey).length;
}

export function hasCustomStationItems(orders) {
  return (Array.isArray(orders) ? orders : []).some((o) =>
    (Array.isArray(o.items) ? o.items : []).some(
      (item) =>
        itemMatchesStation(item, 'custom') &&
        ['pending', 'cooking', 'ready'].includes(item.kitchen_status || o.kitchen_status)
    )
  );
}
