<script setup>
import { nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import { api } from './api/client.js';
import AppHeader from './components/AppHeader.vue';
import CheckoutModal from './components/CheckoutModal.vue';
import QueueTicketModal from './components/QueueTicketModal.vue';
import ReceiptPrint from './components/ReceiptPrint.vue';
import ShopQrModal from './components/ShopQrModal.vue';
import StaffNameModal from './components/StaffNameModal.vue';
import { useAdminMode } from './composables/useAdminMode.js';
import { useCart } from './composables/useCart.js';
import { useStaff } from './composables/useStaff.js';
import { formatQueueNo, getBangkokDateStr } from './utils/format.js';
import AdminView from './views/AdminView.vue';
import CustomerOrderView from './views/CustomerOrderView.vue';
import KitchenView from './views/KitchenView.vue';
import OrdersView from './views/OrdersView.vue';
import PosView from './views/PosView.vue';

const isCustomerRoute = window.location.pathname.startsWith('/order');

const { staffName, recentNames, setStaffName } = useStaff();
const { isAdminMode, tapCount, registerLogoTap, exitAdminMode } = useAdminMode();
const cart = useCart();

const activeTab = ref('pos');
const catalog = ref({
  categories: [],
  menus: [],
  option_groups: [],
});
const adminCategories = ref([]);
const adminMenus = ref([]);

const kitchenOrders = ref([]);
const openOrders = ref([]);
const historyOrders = ref([]);
const historyDate = ref(getBangkokDateStr());

const orderType = ref('dine_in');
const customerName = ref('');
const loadingOrders = ref(false);
const loadingKitchen = ref(false);
const updatingKitchenId = ref(null);
const submittingOrder = ref(false);

const staffModalOpen = ref(!isCustomerRoute && !staffName.value);
const qrModalOpen = ref(false);
const queueTicketOrder = ref(null);
const checkoutContext = ref(null);
const paidOrder = ref(null);

const printOrderData = ref(null);
const printMode = ref('receipt');
const printPosterData = ref(null);

const toast = ref(null);
let toastTimer = null;
let bgPollTimer = null;
let bgPolling = false;

async function pollLiveOrders() {
  if (isCustomerRoute || bgPolling) {
    return;
  }
  bgPolling = true;
  try {
    const [kitchenRes, openRes] = await Promise.all([
      api.getKitchenOrders(),
      api.getOrders({ status: 'open' }),
    ]);
    kitchenOrders.value = kitchenRes.orders || [];
    openOrders.value = openRes.orders || [];
  } catch {
  } finally {
    bgPolling = false;
  }
}

function showToast({ type = 'info', text }) {
  toast.value = { type, text };
  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.value = null;
  }, 3000);
}

async function refreshKitchen() {
  loadingKitchen.value = true;
  try {
    const res = await api.getKitchenOrders();
    kitchenOrders.value = res.orders || [];
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  } finally {
    loadingKitchen.value = false;
  }
}

async function refreshOrders() {
  loadingOrders.value = true;
  try {
    const [openRes, historyRes] = await Promise.all([
      api.getOrders({ status: 'open' }),
      api.getOrders({ status: 'all', date: historyDate.value }),
    ]);
    openOrders.value = openRes.orders || [];
    historyOrders.value = historyRes.orders || [];
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  } finally {
    loadingOrders.value = false;
  }
}

async function refreshOrderLists() {
  try {
    const [kitchenRes, openRes, historyRes] = await Promise.all([
      api.getKitchenOrders(),
      api.getOrders({ status: 'open' }),
      api.getOrders({ status: 'all', date: historyDate.value }),
    ]);
    kitchenOrders.value = kitchenRes.orders || [];
    openOrders.value = openRes.orders || [];
    historyOrders.value = historyRes.orders || [];
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  }
}

async function refreshAll() {
  try {
    const requests = [
      api.getCatalog(),
      api.getKitchenOrders(),
      api.getOrders({ status: 'open' }),
      api.getOrders({ status: 'all', date: historyDate.value }),
    ];
    if (isAdminMode.value) {
      requests.push(api.getCategories(), api.getMenus());
    }

    const results = await Promise.all(requests);
    catalog.value = results[0];
    kitchenOrders.value = results[1].orders || [];
    openOrders.value = results[2].orders || [];
    historyOrders.value = results[3].orders || [];

    if (isAdminMode.value) {
      adminCategories.value = results[4].categories || [];
      adminMenus.value = results[5].menus || [];
    }
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  }
}

watch(historyDate, () => {
  if (!isCustomerRoute) {
    refreshOrders();
  }
});

watch(isAdminMode, (enabled) => {
  if (isCustomerRoute) {
    return;
  }
  if (enabled) {
    refreshAll();
  } else if (activeTab.value === 'admin') {
    activeTab.value = 'pos';
  }
});

onMounted(() => {
  if (!isCustomerRoute) {
    refreshAll();
    bgPollTimer = setInterval(pollLiveOrders, 5000);
  }
});

onUnmounted(() => {
  if (bgPollTimer) {
    clearInterval(bgPollTimer);
  }
});

function handleLogoTap() {
  const result = registerLogoTap();
  if (result.toggled && result.unlocked) {
    showToast({ type: 'info', text: 'เปิดโหมด Admin แล้ว' });
    return;
  }
  if (result.toggled && result.locked) {
    showToast({ type: 'info', text: 'ออกจากโหมด Admin แล้ว' });
  }
}

function handleExitAdmin() {
  exitAdminMode();
  showToast({ type: 'info', text: 'ออกจากโหมด Admin แล้ว' });
}

function handleStaffSubmit(name) {
  if (setStaffName(name)) {
    staffModalOpen.value = false;
    showToast({ type: 'success', text: `สวัสดี ${name}` });
  }
}

function ensureStaff() {
  if (!staffName.value) {
    staffModalOpen.value = true;
    return false;
  }
  return true;
}

async function handleSendToKitchen() {
  if (!ensureStaff() || cart.items.value.length === 0 || submittingOrder.value) {
    return;
  }

  submittingOrder.value = true;
  try {
    const res = await api.createOrder({
      order_type: orderType.value,
      staff_name: staffName.value,
      customer_name: customerName.value.trim() || null,
      items: cart.buildOrderItemsPayload(),
      pay_now: false,
    });
    cart.clearCart();
    customerName.value = '';
    queueTicketOrder.value = res.order;
    await refreshOrderLists();
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  } finally {
    submittingOrder.value = false;
  }
}

function handlePayAndSend() {
  if (!ensureStaff() || cart.items.value.length === 0) {
    return;
  }
  paidOrder.value = null;
  const label = orderType.value === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน';
  const namePart = customerName.value.trim() ? ` • คุณ${customerName.value.trim()}` : '';
  checkoutContext.value = {
    mode: 'new',
    title: `${label}${namePart}`,
    subtotal: cart.subtotal.value,
  };
}

function handleCheckoutOrder(order) {
  if (!ensureStaff()) {
    return;
  }
  queueTicketOrder.value = null;
  paidOrder.value = null;
  checkoutContext.value = {
    mode: 'existing',
    orderId: order.id,
    title: `${formatQueueNo(order.queue_no)} • #${order.order_no}`,
    subtotal: Number(order.subtotal || 0),
    preferredPaymentMethod: order.payment_method || null,
  };
}

async function handleConfirmPay(paymentPayload) {
  if (!checkoutContext.value || submittingOrder.value) {
    return;
  }
  submittingOrder.value = true;
  try {
    let response;
    if (checkoutContext.value.mode === 'new') {
      response = await api.createOrder({
        order_type: orderType.value,
        staff_name: staffName.value,
        customer_name: customerName.value.trim() || null,
        items: cart.buildOrderItemsPayload(),
        pay_now: true,
        ...paymentPayload,
      });
      cart.clearCart();
      customerName.value = '';
    } else {
      response = await api.payOrder(checkoutContext.value.orderId, paymentPayload);
    }

    paidOrder.value = response.order;
    await refreshOrderLists();
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  } finally {
    submittingOrder.value = false;
  }
}

function closeCheckoutModal() {
  checkoutContext.value = null;
  paidOrder.value = null;
}

async function handleUpdateKitchenStatus(orderId, kitchenStatus, categoryId = null) {
  updatingKitchenId.value = orderId;
  try {
    await api.updateKitchenStatus(orderId, kitchenStatus, categoryId);
    await refreshOrderLists();
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  } finally {
    updatingKitchenId.value = null;
  }
}

async function handleCancelOrder({ orderId, reason }) {
  try {
    await api.cancelOrder(orderId, reason);
    showToast({ type: 'success', text: 'ยกเลิกบิลเรียบร้อย' });
    await refreshOrderLists();
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  }
}

async function handleClearAllOrders() {
  try {
    const res = await api.clearAllOrders();
    showToast({
      type: 'success',
      text: `ล้างบิลและคิวทั้งหมดแล้ว (${res.deleted_orders} บิล) • เริ่มคิว Q001 ใหม่`,
    });
    await refreshOrderLists();
  } catch (err) {
    showToast({ type: 'error', text: err.message });
  }
}

async function handlePrint({ order, mode = 'receipt' }) {
  printPosterData.value = null;
  printOrderData.value = order;
  printMode.value = mode;
  await nextTick();
  window.print();
}

async function handlePrintQrPoster(poster) {
  printOrderData.value = null;
  printPosterData.value = poster;
  printMode.value = 'qr_poster';
  await nextTick();
  window.print();
}
</script>

<template>
  <CustomerOrderView v-if="isCustomerRoute" />

  <template v-else>
    <div class="h-dvh flex flex-col bg-surface overflow-hidden no-print">
      <AppHeader
        :active-tab="activeTab"
        :kitchen-active-count="kitchenOrders.length"
        :unpaid-order-count="openOrders.length"
        :staff-name="staffName"
        :is-admin-mode="isAdminMode"
        :tap-count="tapCount"
        @change-tab="activeTab = $event"
        @logo-tap="handleLogoTap"
        @open-qr-modal="qrModalOpen = true"
        @open-staff-modal="staffModalOpen = true"
        @exit-admin="handleExitAdmin"
      />

      <PosView
        v-if="activeTab === 'pos'"
        v-model:order-type="orderType"
        v-model:customer-name="customerName"
        :catalog="catalog"
        :submitting="submittingOrder"
        @send-to-kitchen="handleSendToKitchen"
        @pay-and-send="handlePayAndSend"
        @notify="showToast"
      />

      <KitchenView
        v-else-if="activeTab === 'kitchen'"
        :orders="kitchenOrders"
        :categories="catalog.categories"
        :loading="loadingKitchen"
        :updating-id="updatingKitchenId"
        @refresh="refreshKitchen"
        @update-kitchen-status="handleUpdateKitchenStatus"
        @checkout-order="handleCheckoutOrder"
        @print-order="handlePrint"
      />

      <OrdersView
        v-else-if="activeTab === 'orders'"
        v-model:history-date="historyDate"
        :open-orders="openOrders"
        :history-orders="historyOrders"
        :loading="loadingOrders"
        :is-admin-mode="isAdminMode"
        @refresh="refreshOrders"
        @checkout-order="handleCheckoutOrder"
        @print-order="handlePrint"
        @cancel-order="handleCancelOrder"
        @clear-all-orders="handleClearAllOrders"
      />

      <AdminView
        v-else-if="activeTab === 'admin' && isAdminMode"
        :categories="adminCategories"
        :menus="adminMenus"
        :option-groups="catalog.option_groups"
        :payment-settings="catalog.payment_settings"
        @refresh-all="refreshAll"
        @notify="showToast"
        @print-qr-poster="handlePrintQrPoster"
      />

      <StaffNameModal
        :open="staffModalOpen"
        :current-name="staffName"
        :recent-names="recentNames"
        :required="!staffName"
        @close="staffModalOpen = false"
        @submit="handleStaffSubmit"
      />

      <ShopQrModal
        :open="qrModalOpen"
        @close="qrModalOpen = false"
        @print-poster="(poster) => { qrModalOpen = false; handlePrintQrPoster(poster); }"
        @notify="showToast"
      />

      <QueueTicketModal
        :open="Boolean(queueTicketOrder)"
        :order="queueTicketOrder"
        @close="queueTicketOrder = null"
        @print-queue="(order) => handlePrint({ order, mode: 'queue' })"
        @print-kitchen="(order) => handlePrint({ order, mode: 'kitchen' })"
        @checkout-order="handleCheckoutOrder"
      />

      <CheckoutModal
        :open="Boolean(checkoutContext)"
        :order-summary="checkoutContext"
        :payment-settings="catalog.payment_settings"
        :loading="submittingOrder"
        :paid-order="paidOrder"
        @close="closeCheckoutModal"
        @confirm-pay="handleConfirmPay"
        @print-receipt="(order) => handlePrint({ order, mode: 'receipt' })"
        @print-kitchen="(order) => handlePrint({ order, mode: 'kitchen' })"
      />

      <div
        v-if="toast"
        class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold text-white pointer-events-none max-w-[90vw] text-center"
        :class="{
          'bg-emerald-600': toast.type === 'success',
          'bg-red-600': toast.type === 'error',
          'bg-stone-900': toast.type === 'info',
        }"
      >
        {{ toast.text }}
      </div>
    </div>

    <ReceiptPrint
      :order="printOrderData"
      :mode="printMode"
      :poster-data="printPosterData"
    />
  </template>
</template>
