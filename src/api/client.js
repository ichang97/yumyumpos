async function apiFetch(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  let body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(body);
  }

  const response = await fetch(`/api${path}`, {
    ...options,
    headers,
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const err = new Error(data.error || 'เกิดข้อผิดพลาดในการเชื่อมต่อเซิร์ฟเวอร์');
    err.status = response.status;
    throw err;
  }
  return data;
}

export const api = {
  getMe: () => apiFetch('/me'),
  getCatalog: () => apiFetch('/catalog'),

  getCategories: () => apiFetch('/categories'),
  createCategory: (payload) => apiFetch('/categories', { method: 'POST', body: payload }),
  updateCategory: (id, payload) => apiFetch(`/categories/${id}`, { method: 'PUT', body: payload }),
  deleteCategory: (id) => apiFetch(`/categories/${id}`, { method: 'DELETE' }),

  getOptionGroups: () => apiFetch('/option-groups'),
  createOptionGroup: (payload) => apiFetch('/option-groups', { method: 'POST', body: payload }),
  updateOptionGroup: (id, payload) =>
    apiFetch(`/option-groups/${id}`, { method: 'PUT', body: payload }),
  deleteOptionGroup: (id) => apiFetch(`/option-groups/${id}`, { method: 'DELETE' }),

  createOption: (groupId, payload) =>
    apiFetch(`/option-groups/${groupId}/options`, { method: 'POST', body: payload }),
  updateOption: (id, payload) => apiFetch(`/options/${id}`, { method: 'PUT', body: payload }),
  toggleOptionAvailability: (id, isAvailable) =>
    apiFetch(`/options/${id}/availability`, {
      method: 'PATCH',
      body: { is_available: isAvailable },
    }),
  deleteOption: (id) => apiFetch(`/options/${id}`, { method: 'DELETE' }),

  getMenus: () => apiFetch('/menus'),
  createMenu: (payload) => apiFetch('/menus', { method: 'POST', body: payload }),
  updateMenu: (id, payload) => apiFetch(`/menus/${id}`, { method: 'PUT', body: payload }),
  toggleMenuAvailability: (id, isAvailable) =>
    apiFetch(`/menus/${id}/availability`, {
      method: 'PATCH',
      body: { is_available: isAvailable },
    }),
  deleteMenu: (id) => apiFetch(`/menus/${id}`, { method: 'DELETE' }),

  getOrders: ({ status = 'all', date } = {}) => {
    const params = new URLSearchParams();
    if (status) {
      params.set('status', status);
    }
    if (date) {
      params.set('date', date);
    }
    return apiFetch(`/orders?${params.toString()}`);
  },
  getKitchenOrders: () => apiFetch('/kitchen'),
  getOrder: (id) => apiFetch(`/orders/${id}`),
  createOrder: (payload) => apiFetch('/orders', { method: 'POST', body: payload }),
  updateKitchenStatus: (id, kitchenStatus, categoryId = null) => {
    const body = { kitchen_status: kitchenStatus };
    if (
      categoryId !== null &&
      categoryId !== undefined &&
      categoryId !== '' &&
      categoryId !== 'all'
    ) {
      body.category_id = categoryId;
    }
    return apiFetch(`/orders/${id}/kitchen-status`, {
      method: 'PATCH',
      body,
    });
  },
  payOrder: (id, payload) => apiFetch(`/orders/${id}/pay`, { method: 'POST', body: payload }),
  cancelOrder: (id, cancelReason) =>
    apiFetch(`/orders/${id}/cancel`, {
      method: 'POST',
      body: { cancel_reason: cancelReason },
    }),
  clearAllOrders: () =>
    apiFetch('/orders/clear-all', {
      method: 'POST',
      body: { confirm: 'CLEAR_ALL' },
    }),

  getReportSummary: ({ from, to } = {}) => {
    const params = new URLSearchParams();
    if (from) {
      params.set('from', from);
    }
    if (to) {
      params.set('to', to);
    }
    return apiFetch(`/reports/summary?${params.toString()}`);
  },

  getPublicCatalog: () => apiFetch('/public/catalog'),
  createPublicOrder: (payload) => apiFetch('/public/orders', { method: 'POST', body: payload }),
  getPublicOrder: (token) => apiFetch(`/public/orders/${encodeURIComponent(token)}`),

  getPaymentSettings: () => apiFetch('/settings/payment'),
  updatePaymentSettings: (payload) =>
    apiFetch('/settings/payment', { method: 'PUT', body: payload }),
};
