<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import {
  Banknote,
  CheckCircle2,
  ChefHat,
  Clock,
  Download,
  Minus,
  Plus,
  QrCode,
  RefreshCw,
  Search,
  ShoppingBag,
  Ticket,
  Trash2,
  UserRound,
  Utensils,
  UtensilsCrossed,
  X,
} from 'lucide-vue-next';
import { api } from '../api/client.js';
import MenuOptionSheet from '../components/MenuOptionSheet.vue';
import { formatBaht, formatQueueNo, formatTime, getBangkokDateStr } from '../utils/format.js';
import {
  buildPromptPayPayload,
  formatPromptPayDisplay,
  isValidPromptPayId,
} from '../utils/promptpay.js';

const SAVED_QUEUES_KEY = 'yumyum_customer_queues';

const catalog = ref({
  categories: [],
  menus: [],
  option_groups: [],
  payment_settings: {
    enable_cash: true,
    enable_qr: true,
    promptpay_id: '',
    promptpay_name: '',
    has_qr_image: false,
    qr_image_url: '',
  },
});
const loadingCatalog = ref(true);
const orderType = ref('dine_in');
const customerName = ref('');
const selectedPaymentMethod = ref('cash');
const selectedCategoryId = ref(0);
const searchQuery = ref('');

const cartItems = ref([]);
const cartDrawerOpen = ref(false);
const optionSheetMenu = ref(null);
const submitting = ref(false);

const viewMode = ref('menu');
const savedQueues = ref([]);
const activeToken = ref('');
const trackedOrder = ref(null);
const loadingTrack = ref(false);
const trackerQrDataUrl = ref('');

const bannerMessage = ref(null);
let bannerTimer = null;
let pollTimer = null;

function showBanner(type, text) {
  bannerMessage.value = { type, text };
  if (bannerTimer) {
    clearTimeout(bannerTimer);
  }
  bannerTimer = setTimeout(() => {
    bannerMessage.value = null;
  }, 3500);
}

function loadSavedQueues() {
  try {
    const today = getBangkokDateStr();
    const raw = localStorage.getItem(SAVED_QUEUES_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }
    const filtered = parsed.filter(
      (item) => item && item.tracking_token && item.queue_date === today
    );
    localStorage.setItem(SAVED_QUEUES_KEY, JSON.stringify(filtered));
    return filtered;
  } catch {
    return [];
  }
}

function persistQueue(order) {
  const entry = {
    tracking_token: order.tracking_token,
    queue_no: order.queue_no,
    queue_date: order.queue_date,
    order_no: order.order_no,
  };
  const next = [
    entry,
    ...savedQueues.value.filter((q) => q.tracking_token !== order.tracking_token),
  ].slice(0, 10);
  savedQueues.value = next;
  localStorage.setItem(SAVED_QUEUES_KEY, JSON.stringify(next));
}

function removeSavedQueue(token) {
  if (!token) {
    return;
  }
  const next = savedQueues.value.filter((q) => q.tracking_token !== token);
  savedQueues.value = next;
  try {
    localStorage.setItem(SAVED_QUEUES_KEY, JSON.stringify(next));
  } catch {
  }
  if (activeToken.value === token) {
    activeToken.value = next[0]?.tracking_token || '';
  }
}

const optionGroupsMap = computed(() => {
  const map = new Map();
  for (const group of catalog.value.option_groups || []) {
    map.set(group.id, group);
  }
  return map;
});

const filteredMenus = computed(() => {
  const q = searchQuery.value.trim().toLowerCase();
  return (catalog.value.menus || []).filter((menu) => {
    if (selectedCategoryId.value !== 0 && menu.category_id !== selectedCategoryId.value) {
      return false;
    }
    if (q && !menu.name.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
});

const selectedMenuOptionGroups = computed(() => {
  if (!optionSheetMenu.value) {
    return [];
  }
  return (optionSheetMenu.value.option_group_ids || [])
    .map((id) => optionGroupsMap.value.get(id))
    .filter(Boolean);
});

const cartCount = computed(() =>
  cartItems.value.reduce((sum, item) => sum + item.quantity, 0)
);

const cartSubtotal = computed(() => {
  const sum = cartItems.value.reduce(
    (total, item) => total + item.unit_price * item.quantity,
    0
  );
  return Math.round(sum * 100) / 100;
});

function buildCartKey(entry) {
  const optionIds = (entry.selected_options || [])
    .map((o) => o.id)
    .sort((a, b) => a - b)
    .join(',');
  return `${entry.menu_id}:[${optionIds}]:${(entry.note || '').trim()}`;
}

function addCartItem(entry) {
  const selectedOptions = Array.isArray(entry.selected_options) ? entry.selected_options : [];
  const optionsPrice =
    Math.round(
      selectedOptions.reduce((sum, opt) => sum + Number(opt.price_delta || 0), 0) * 100
    ) / 100;
  const basePrice = Math.round(Number(entry.base_price || 0) * 100) / 100;
  const unitPrice = Math.round((basePrice + optionsPrice) * 100) / 100;
  const quantity = Math.max(1, Number(entry.quantity) || 1);
  const note = (entry.note || '').trim();
  const key = buildCartKey({ menu_id: entry.menu_id, selected_options: selectedOptions, note });

  const existing = cartItems.value.find((i) => i.key === key);
  if (existing) {
    existing.quantity += quantity;
    return;
  }

  cartItems.value.push({
    key,
    menu_id: entry.menu_id,
    menu_name: entry.menu_name,
    base_price: basePrice,
    selected_options: selectedOptions,
    unit_price: unitPrice,
    quantity,
    note,
  });
}

function updateCartQty(key, delta) {
  const idx = cartItems.value.findIndex((i) => i.key === key);
  if (idx === -1) {
    return;
  }
  const next = cartItems.value[idx].quantity + delta;
  if (next <= 0) {
    cartItems.value.splice(idx, 1);
    return;
  }
  cartItems.value[idx].quantity = next;
}

function removeCartItem(key) {
  const idx = cartItems.value.findIndex((i) => i.key === key);
  if (idx !== -1) {
    cartItems.value.splice(idx, 1);
  }
}

function handleMenuTap(menu) {
  if (!menu.is_available) {
    return;
  }
  if (!menu.option_group_ids || menu.option_group_ids.length === 0) {
    addCartItem({
      menu_id: menu.id,
      menu_name: menu.name,
      base_price: menu.base_price,
      selected_options: [],
      quantity: 1,
      note: '',
    });
    showBanner('success', `เพิ่ม "${menu.name}" ลงตะกร้าแล้ว`);
    return;
  }
  optionSheetMenu.value = menu;
}

function handleOptionConfirm(entry) {
  addCartItem(entry);
  optionSheetMenu.value = null;
  showBanner('success', `เพิ่ม "${entry.menu_name}" ลงตะกร้าแล้ว`);
}

const paymentSettings = computed(() => ({
  enable_cash: catalog.value.payment_settings?.enable_cash !== false,
  enable_qr: catalog.value.payment_settings?.enable_qr !== false,
  promptpay_id: catalog.value.payment_settings?.promptpay_id || '',
  promptpay_name: catalog.value.payment_settings?.promptpay_name || '',
  has_qr_image: Boolean(catalog.value.payment_settings?.has_qr_image),
  qr_image_url: catalog.value.payment_settings?.qr_image_url || '',
}));

const uploadedQrUrl = computed(() =>
  paymentSettings.value.has_qr_image && paymentSettings.value.qr_image_url
    ? paymentSettings.value.qr_image_url
    : ''
);

async function fetchPublicCatalog() {
  loadingCatalog.value = true;
  try {
    catalog.value = await api.getPublicCatalog();
    if (selectedPaymentMethod.value === 'cash' && !paymentSettings.value.enable_cash) {
      selectedPaymentMethod.value = 'transfer';
    } else if (selectedPaymentMethod.value === 'transfer' && !paymentSettings.value.enable_qr) {
      selectedPaymentMethod.value = 'cash';
    }
  } catch (err) {
    showBanner('error', err.message);
  } finally {
    loadingCatalog.value = false;
  }
}

async function fetchTrackedOrder(silent = false) {
  if (!activeToken.value) {
    return;
  }
  const requestedToken = activeToken.value;
  if (!silent) {
    loadingTrack.value = true;
  }
  try {
    const res = await api.getPublicOrder(requestedToken);
    trackedOrder.value = res.order;
  } catch (err) {
    if (err?.status === 404) {
      removeSavedQueue(requestedToken);
      trackedOrder.value = null;
      if (activeToken.value) {
        fetchTrackedOrder(true);
      } else if (viewMode.value === 'tracker') {
        viewMode.value = 'menu';
      }
      if (!silent) {
        showBanner('error', 'ไม่พบคิวนี้ในระบบแล้ว');
      }
      return;
    }
    if (!silent) {
      showBanner('error', err.message);
    }
  } finally {
    if (!silent) {
      loadingTrack.value = false;
    }
  }
}

async function pruneStaleSavedQueues() {
  const snapshot = [...savedQueues.value];
  for (const entry of snapshot) {
    try {
      await api.getPublicOrder(entry.tracking_token);
    } catch (err) {
      if (err?.status === 404) {
        removeSavedQueue(entry.tracking_token);
      }
    }
  }
}

async function submitPublicOrder() {
  if (cartItems.value.length === 0 || submitting.value) {
    return;
  }
  submitting.value = true;
  try {
    const res = await api.createPublicOrder({
      order_type: orderType.value,
      customer_name: customerName.value.trim() || null,
      payment_method: selectedPaymentMethod.value,
      items: cartItems.value.map((item) => ({
        menu_id: item.menu_id,
        option_ids: item.selected_options.map((o) => o.id),
        quantity: item.quantity,
        note: item.note || null,
      })),
    });

    cartItems.value = [];
    cartDrawerOpen.value = false;
    trackedOrder.value = res.order;
    activeToken.value = res.order.tracking_token;
    persistQueue(res.order);
    viewMode.value = 'tracker';
  } catch (err) {
    showBanner('error', err.message);
  } finally {
    submitting.value = false;
  }
}

function openSavedQueue(token) {
  activeToken.value = token;
  viewMode.value = 'tracker';
  fetchTrackedOrder(false);
}

const isOrderActiveForPolling = computed(() => {
  if (viewMode.value !== 'tracker' || !activeToken.value) {
    return false;
  }
  if (!trackedOrder.value) {
    return true;
  }
  return (
    trackedOrder.value.status !== 'cancelled' &&
    ['pending', 'cooking', 'ready'].includes(trackedOrder.value.kitchen_status)
  );
});

function stopPolling() {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

watch(
  isOrderActiveForPolling,
  (shouldPoll) => {
    stopPolling();
    if (shouldPoll) {
      pollTimer = setInterval(() => {
        fetchTrackedOrder(true);
      }, 5000);
    }
  },
  { immediate: true }
);

const stepIndex = computed(() => {
  if (!trackedOrder.value) {
    return 0;
  }
  if (trackedOrder.value.status !== 'paid') {
    return 0;
  }
  const ks = trackedOrder.value.kitchen_status;
  if (ks === 'cooking') {
    return 2;
  }
  if (ks === 'ready' || ks === 'completed') {
    return 3;
  }
  return 1;
});

watch(
  () => [
    viewMode.value,
    trackedOrder.value?.status,
    trackedOrder.value?.payment_method,
    trackedOrder.value?.total_amount,
    uploadedQrUrl.value,
    paymentSettings.value.promptpay_id,
  ],
  async ([mode, status, method, total, customQrUrl, ppId]) => {
    if (
      mode !== 'tracker' ||
      status !== 'open' ||
      method !== 'transfer' ||
      customQrUrl ||
      !isValidPromptPayId(ppId)
    ) {
      trackerQrDataUrl.value = '';
      return;
    }
    const payload = buildPromptPayPayload(ppId, Number(total) > 0 ? Number(total) : null);
    if (!payload) {
      trackerQrDataUrl.value = '';
      return;
    }
    try {
      trackerQrDataUrl.value = await QRCode.toDataURL(payload, { width: 280, margin: 2 });
    } catch {
      trackerQrDataUrl.value = '';
    }
  },
  { immediate: true }
);

onMounted(() => {
  savedQueues.value = loadSavedQueues();
  if (savedQueues.value.length > 0) {
    activeToken.value = savedQueues.value[0].tracking_token;
    pruneStaleSavedQueues();
  }
  fetchPublicCatalog();
});

onUnmounted(() => {
  stopPolling();
});
</script>

<template>
  <div class="min-h-dvh flex flex-col bg-surface">
    <header class="sticky top-0 z-30 bg-white border-b border-stone-200 pt-safe">
      <div class="max-w-3xl mx-auto px-3.5 h-14 flex items-center justify-between gap-2">
        <div class="flex items-center gap-2">
          <span class="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center shadow-xs">
            <UtensilsCrossed class="w-5 h-5" />
          </span>
          <div class="leading-tight">
            <span class="block font-bold text-stone-900 text-sm md:text-base">YumYum POS</span>
            <span class="block text-[11px] font-medium text-stone-500">สั่งอาหารหน้าร้าน</span>
          </div>
        </div>

        <button
          v-if="viewMode === 'menu' && savedQueues.length > 0"
          type="button"
          class="min-h-10 px-3 rounded-xl bg-orange-50 border border-orange-200 text-brand-dark font-bold text-xs md:text-sm flex items-center gap-1.5"
          @click="openSavedQueue(savedQueues[0].tracking_token)"
        >
          <Ticket class="w-4 h-4" />
          <span>คิวของฉัน ({{ formatQueueNo(savedQueues[0].queue_no) }})</span>
        </button>

        <button
          v-else-if="viewMode === 'tracker'"
          type="button"
          class="min-h-10 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-800 font-bold text-xs md:text-sm"
          @click="viewMode = 'menu'"
        >
          + สั่งอาหารเพิ่ม
        </button>
      </div>
    </header>

    <main v-if="viewMode === 'menu'" class="flex-1 max-w-3xl w-full mx-auto p-3.5 pb-28 space-y-3.5">
      <div class="bg-white rounded-2xl border border-stone-200 p-3 space-y-2.5">
        <div class="grid grid-cols-2 gap-2">
          <button
            type="button"
            class="min-h-11 rounded-xl border font-bold text-sm flex items-center justify-center gap-1.5 transition"
            :class="
              orderType === 'dine_in'
                ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                : 'bg-white border-stone-200 text-stone-700'
            "
            @click="orderType = 'dine_in'"
          >
            <Utensils class="w-4 h-4" />
            <span>ทานที่ร้าน</span>
          </button>

          <button
            type="button"
            class="min-h-11 rounded-xl border font-bold text-sm flex items-center justify-center gap-1.5 transition"
            :class="
              orderType === 'takeaway'
                ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                : 'bg-white border-stone-200 text-stone-700'
            "
            @click="orderType = 'takeaway'"
          >
            <ShoppingBag class="w-4 h-4" />
            <span>สั่งกลับบ้าน</span>
          </button>
        </div>

        <div class="relative">
          <UserRound class="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            v-model="customerName"
            type="text"
            maxlength="60"
            placeholder="ชื่อเล่นของคุณ (ไม่บังคับ)"
            class="w-full min-h-10 pl-9 pr-3 rounded-xl border border-stone-200 bg-stone-50/70 text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand"
          />
        </div>
      </div>

      <div class="relative">
        <Search class="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          v-model="searchQuery"
          type="search"
          placeholder="ค้นหาเมนูอาหาร..."
          class="w-full min-h-11 pl-10 pr-9 rounded-xl border border-stone-200 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand"
        />
        <button
          v-if="searchQuery"
          type="button"
          class="absolute right-2 top-1/2 -translate-y-1/2 w-8 h-8 rounded-lg text-stone-400 hover:text-stone-700 flex items-center justify-center"
          @click="searchQuery = ''"
        >
          <X class="w-4 h-4" />
        </button>
      </div>

      <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          class="min-h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition shrink-0"
          :class="
            selectedCategoryId === 0
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700'
          "
          @click="selectedCategoryId = 0"
        >
          ทั้งหมด
        </button>
        <button
          v-for="cat in catalog.categories"
          :key="cat.id"
          type="button"
          class="min-h-10 px-4 rounded-full text-sm font-semibold whitespace-nowrap transition shrink-0"
          :class="
            selectedCategoryId === cat.id
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700'
          "
          @click="selectedCategoryId = cat.id"
        >
          {{ cat.name }}
        </button>
      </div>

      <div v-if="loadingCatalog" class="py-12 text-center text-stone-400 text-sm">
        กำลังโหลดรายการอาหาร...
      </div>

      <div
        v-else-if="filteredMenus.length > 0"
        class="grid grid-cols-2 sm:grid-cols-3 gap-2.5"
      >
        <button
          v-for="menu in filteredMenus"
          :key="menu.id"
          type="button"
          :disabled="!menu.is_available"
          class="text-left p-3.5 rounded-2xl border transition flex flex-col justify-between min-h-28 active:scale-98"
          :class="
            menu.is_available
              ? 'bg-white border-stone-200 hover:border-brand shadow-2xs'
              : 'bg-stone-100 border-stone-200 opacity-60 cursor-not-allowed'
          "
          @click="handleMenuTap(menu)"
        >
          <div class="space-y-1">
            <h3 class="font-bold text-stone-900 text-sm md:text-base leading-snug line-clamp-2">
              {{ menu.name }}
            </h3>
            <p
              v-if="menu.option_group_ids && menu.option_group_ids.length > 0"
              class="text-[11px] font-medium text-stone-500"
            >
              เลือกตัวเลือกได้
            </p>
          </div>

          <div class="pt-3 flex items-center justify-between gap-2">
            <span class="font-bold text-brand text-base tabular-nums">
              {{ formatBaht(menu.base_price) }}
            </span>
            <span
              v-if="!menu.is_available"
              class="px-2 py-0.5 rounded-full bg-red-100 text-red-700 text-[11px] font-bold"
            >
              หมด
            </span>
            <span
              v-else
              class="w-7 h-7 rounded-full bg-orange-50 text-brand flex items-center justify-center"
            >
              <Plus class="w-4 h-4" />
            </span>
          </div>
        </button>
      </div>

      <div v-else class="py-12 text-center bg-white rounded-2xl border border-stone-200 text-stone-400 text-sm">
        ไม่พบเมนูที่ค้นหา
      </div>
    </main>

    <main v-else class="flex-1 max-w-xl w-full mx-auto p-3.5 pb-12 space-y-4">
      <div v-if="savedQueues.length > 1" class="flex items-center gap-2 overflow-x-auto no-scrollbar">
        <button
          v-for="q in savedQueues"
          :key="q.tracking_token"
          type="button"
          class="min-h-9 px-3 rounded-full text-xs font-bold border whitespace-nowrap shrink-0 tabular-nums"
          :class="
            activeToken === q.tracking_token
              ? 'bg-brand border-brand text-white'
              : 'bg-white border-stone-200 text-stone-700'
          "
          @click="openSavedQueue(q.tracking_token)"
        >
          {{ formatQueueNo(q.queue_no) }}
        </button>
      </div>

      <div v-if="loadingTrack && !trackedOrder" class="py-16 text-center text-stone-400 text-sm">
        กำลังโหลดสถานะคิว...
      </div>

      <template v-else-if="trackedOrder">
        <div class="bg-white rounded-3xl border border-stone-200 p-5 text-center space-y-3 shadow-xs">
          <div class="flex items-center justify-between text-xs text-stone-500">
            <span>บิล #{{ trackedOrder.order_no }}</span>
            <button
              type="button"
              class="inline-flex items-center gap-1 text-brand font-semibold"
              @click="fetchTrackedOrder(false)"
            >
              <RefreshCw class="w-3.5 h-3.5" :class="{ 'animate-spin': loadingTrack }" />
              <span>อัปเดต</span>
            </button>
          </div>

          <div
            class="p-5 rounded-2xl border-2 space-y-1"
            :class="
              trackedOrder.status === 'open'
                ? 'bg-amber-50 border-amber-400'
                : 'bg-orange-50 border-brand'
            "
          >
            <p
              class="text-xs font-bold uppercase tracking-wider"
              :class="trackedOrder.status === 'open' ? 'text-amber-800' : 'text-brand-dark'"
            >
              {{ trackedOrder.status === 'open' ? 'คิวรอชำระเงิน (ยังไม่เข้าครัว)' : 'เลขคิวของคุณ' }}
            </p>
            <p
              class="text-6xl font-bold tabular-nums leading-none"
              :class="trackedOrder.status === 'open' ? 'text-amber-700' : 'text-brand'"
            >
              {{ formatQueueNo(trackedOrder.queue_no) }}
            </p>
            <div class="flex items-center justify-center gap-2 pt-2 flex-wrap text-xs font-semibold">
              <span class="px-2.5 py-1 rounded-full bg-white border border-orange-200 text-stone-800">
                {{ trackedOrder.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}
              </span>
              <span
                v-if="trackedOrder.customer_name"
                class="px-2.5 py-1 rounded-full bg-white border border-orange-200 text-stone-800"
              >
                คุณ{{ trackedOrder.customer_name }}
              </span>
              <span class="px-2.5 py-1 rounded-full bg-white border border-orange-200 text-stone-600">
                สั่งเวลา {{ formatTime(trackedOrder.created_at) }}
              </span>
            </div>
          </div>

          <div
            v-if="trackedOrder.status === 'cancelled'"
            class="p-4 rounded-2xl bg-red-50 border border-red-200 text-red-800 text-sm font-semibold"
          >
            <p class="font-bold">ออเดอร์นี้ถูกยกเลิกแล้ว</p>
            <p v-if="trackedOrder.cancel_reason" class="text-xs mt-1">
              เหตุผล: {{ trackedOrder.cancel_reason }}
            </p>
          </div>

          <div v-else class="space-y-2 text-left pt-1">
            <div
              class="p-3 rounded-xl border flex items-center gap-3"
              :class="
                trackedOrder.status === 'paid'
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-950'
                  : 'bg-amber-50 border-amber-300 text-amber-950 ring-1 ring-amber-400'
              "
            >
              <CheckCircle2
                v-if="trackedOrder.status === 'paid'"
                class="w-5 h-5 text-emerald-600 shrink-0"
              />
              <Banknote v-else class="w-5 h-5 text-amber-600 shrink-0" />
              <div class="text-sm">
                <p class="font-bold">
                  {{ trackedOrder.status === 'paid' ? '1. ชำระเงินแล้ว' : '1. รอชำระเงิน' }}
                </p>
                <p class="text-xs opacity-80">
                  {{
                    trackedOrder.status === 'paid'
                      ? 'ยืนยันการชำระเงินเรียบร้อย'
                      : 'กรุณาชำระเงินและให้พนักงานยืนยัน "ชำระแล้ว" เพื่อส่งคิวเข้าครัว'
                  }}
                </p>
              </div>
            </div>

            <div
              class="p-3 rounded-xl border flex items-center gap-3"
              :class="
                stepIndex >= 1
                  ? 'bg-orange-50/70 border-orange-200 text-stone-900'
                  : 'bg-stone-50 border-stone-200 text-stone-400'
              "
            >
              <Clock class="w-5 h-5 shrink-0" :class="stepIndex >= 1 ? 'text-brand' : ''" />
              <div class="text-sm">
                <p class="font-bold">2. รอทำอาหาร</p>
                <p class="text-xs opacity-75">คิวถูกส่งเข้าครัวเรียบร้อยแล้ว</p>
              </div>
            </div>

            <div
              class="p-3 rounded-xl border flex items-center gap-3"
              :class="
                stepIndex >= 2
                  ? 'bg-sky-50 border-sky-200 text-sky-950'
                  : 'bg-stone-50 border-stone-200 text-stone-400'
              "
            >
              <ChefHat class="w-5 h-5 shrink-0" :class="stepIndex >= 2 ? 'text-sky-600' : ''" />
              <div class="text-sm">
                <p class="font-bold">3. กำลังทำอาหาร</p>
                <p class="text-xs opacity-75">ครัวกำลังปรุงอาหารตามคิว</p>
              </div>
            </div>

            <div
              class="p-3.5 rounded-xl border flex items-center gap-3"
              :class="
                stepIndex >= 3
                  ? 'bg-emerald-50 border-emerald-300 text-emerald-950 ring-1 ring-emerald-400'
                  : 'bg-stone-50 border-stone-200 text-stone-400'
              "
            >
              <CheckCircle2
                class="w-5 h-5 shrink-0"
                :class="stepIndex >= 3 ? 'text-emerald-600' : ''"
              />
              <div class="text-sm">
                <p class="font-bold">
                  {{
                    trackedOrder.kitchen_status === 'completed'
                      ? '4. ส่งมอบอาหารเรียบร้อย'
                      : '4. อาหารเสร็จแล้ว! เชิญรับที่เคาน์เตอร์'
                  }}
                </p>
                <p class="text-xs opacity-80">ชำระเงินเรียบร้อยแล้ว</p>
              </div>
            </div>
          </div>
        </div>

        <div
          v-if="trackedOrder.status === 'open' && trackedOrder.payment_method === 'transfer'"
          class="bg-white rounded-3xl border border-sky-200 p-5 text-center space-y-3 shadow-xs"
        >
          <p class="text-sm font-bold text-sky-950">ชำระเงินด้วยการสแกน QR Code</p>
          <template v-if="uploadedQrUrl">
            <img
              :src="uploadedQrUrl"
              alt="QR ชำระเงินของร้าน"
              class="max-w-full max-h-80 w-auto mx-auto rounded-2xl border border-sky-200 bg-white p-2 object-contain"
            />
            <p class="text-xs font-bold text-sky-900">
              บันทึกรูป QR หรือ Capture หน้าจอสแกนผ่านแอพธนาคาร
            </p>
            <div class="space-y-0.5">
              <p class="text-2xl font-bold text-brand tabular-nums">
                {{ formatBaht(trackedOrder.total_amount) }}
              </p>
              <p v-if="paymentSettings.promptpay_name" class="text-sm font-bold text-stone-900">
                {{ paymentSettings.promptpay_name }}
              </p>
            </div>
            <a
              :href="uploadedQrUrl"
              :download="`payment-qr-${formatQueueNo(trackedOrder.queue_no)}`"
              class="inline-flex min-h-10 px-4 rounded-xl bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-900 text-xs font-bold items-center gap-1.5"
            >
              <Download class="w-4 h-4" />
              <span>บันทึกรูป QR</span>
            </a>
            <p class="text-xs text-stone-500">
              โอนเงินแล้วกรุณาแสดงสลิปให้พนักงานกดยืนยัน "ชำระแล้ว" เพื่อส่งคิวเข้าครัว
            </p>
          </template>
          <template v-else-if="trackerQrDataUrl">
            <img
              :src="trackerQrDataUrl"
              alt="PromptPay QR Code"
              class="w-52 h-52 mx-auto rounded-2xl border border-sky-200 bg-white p-2"
            />
            <p class="text-xs font-bold text-sky-900">
              บันทึกรูป QR หรือ Capture หน้าจอสแกนผ่านแอพธนาคาร
            </p>
            <div class="space-y-0.5">
              <p class="text-2xl font-bold text-brand tabular-nums">
                {{ formatBaht(trackedOrder.total_amount) }}
              </p>
              <p v-if="paymentSettings.promptpay_name" class="text-sm font-bold text-stone-900">
                {{ paymentSettings.promptpay_name }}
              </p>
              <p class="text-xs text-stone-600 tabular-nums">
                พร้อมเพย์: {{ formatPromptPayDisplay(paymentSettings.promptpay_id) }}
              </p>
            </div>
            <a
              :href="trackerQrDataUrl"
              :download="`promptpay-${formatQueueNo(trackedOrder.queue_no)}.png`"
              class="inline-flex min-h-10 px-4 rounded-xl bg-sky-50 border border-sky-200 hover:bg-sky-100 text-sky-900 text-xs font-bold items-center gap-1.5"
            >
              <Download class="w-4 h-4" />
              <span>บันทึกรูป QR</span>
            </a>
            <p class="text-xs text-stone-500">
              โอนเงินแล้วกรุณาแสดงสลิปให้พนักงานกดยืนยัน "ชำระแล้ว" เพื่อส่งคิวเข้าครัว
            </p>
          </template>
          <p v-else class="text-xs text-stone-600">
            กรุณาชำระเงินด้วยการสแกน QR ที่หน้าเคาน์เตอร์ตอนรับอาหาร
          </p>
        </div>

        <div
          v-else-if="trackedOrder.status === 'open' && trackedOrder.payment_method === 'cash'"
          class="p-3.5 rounded-2xl bg-amber-50 border border-amber-200 text-amber-900 text-xs font-semibold text-center"
        >
          เลือกชำระด้วยเงินสด — กรุณาแจ้งคิว {{ formatQueueNo(trackedOrder.queue_no) }} และชำระเงิน {{ formatBaht(trackedOrder.total_amount) }} ที่เคาน์เตอร์ เพื่อให้พนักงานกดยืนยัน "ชำระแล้ว" ส่งคิวเข้าครัว
        </div>

        <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-2.5">
          <div class="flex items-center justify-between text-sm font-bold text-stone-900 pb-2 border-b border-stone-100">
            <span>รายการอาหารที่สั่ง</span>
            <span
              class="px-2.5 py-0.5 rounded-full text-xs"
              :class="
                trackedOrder.status === 'paid'
                  ? 'bg-emerald-100 text-emerald-800'
                  : trackedOrder.status === 'cancelled'
                    ? 'bg-red-100 text-red-700'
                    : 'bg-amber-100 text-amber-800'
              "
            >
              {{
                trackedOrder.status === 'paid'
                  ? 'ชำระเงินแล้ว'
                  : trackedOrder.status === 'cancelled'
                    ? 'ยกเลิกแล้ว'
                    : 'รอชำระเงิน'
              }}
            </span>
          </div>

          <div
            v-for="item in trackedOrder.items"
            :key="item.id"
            class="flex items-start justify-between gap-2 text-sm"
          >
            <div class="min-w-0">
              <p class="font-semibold text-stone-900">{{ item.quantity }}x {{ item.menu_name }}</p>
              <p v-if="item.options.length > 0" class="text-xs text-stone-500">
                {{
                  item.options
                    .map((o) => (o.price_delta > 0 ? `${o.option_name} (+${o.price_delta})` : o.option_name))
                    .join(', ')
                }}
              </p>
              <p v-if="item.note" class="text-xs text-brand-dark">หมายเหตุ: {{ item.note }}</p>
            </div>
            <span class="font-semibold text-stone-800 tabular-nums shrink-0">
              {{ formatBaht(item.line_total) }}
            </span>
          </div>

          <div class="pt-2.5 border-t border-stone-200 flex items-center justify-between font-bold text-base">
            <span>ยอดรวมทั้งสิ้น</span>
            <span class="text-xl text-brand tabular-nums">{{ formatBaht(trackedOrder.total_amount) }}</span>
          </div>
        </div>

        <button
          type="button"
          class="w-full min-h-12 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm"
          @click="viewMode = 'menu'"
        >
          สั่งอาหารเพิ่มอีกออเดอร์
        </button>
      </template>
    </main>

    <div
      v-if="viewMode === 'menu' && cartCount > 0"
      class="fixed bottom-0 inset-x-0 z-20 bg-white border-t border-stone-200 p-3 pb-safe shadow-lg"
    >
      <div class="max-w-3xl mx-auto">
        <button
          type="button"
          class="w-full min-h-12 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold flex items-center justify-between gap-3"
          @click="cartDrawerOpen = true"
        >
          <div class="flex items-center gap-2 text-sm">
            <span class="px-2 py-0.5 rounded-full bg-white/20 text-xs font-bold tabular-nums">
              {{ cartCount }} รายการ
            </span>
            <span>ดูตะกร้าและสั่งอาหาร</span>
          </div>
          <span class="text-base tabular-nums shrink-0">{{ formatBaht(cartSubtotal) }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="cartDrawerOpen"
      class="fixed inset-0 z-40 bg-stone-900/50 flex items-end justify-center"
      @click.self="cartDrawerOpen = false"
    >
      <div class="bg-white w-full max-w-lg max-h-[90dvh] rounded-t-3xl overflow-hidden flex flex-col shadow-2xl">
        <div class="px-5 py-3.5 border-b border-stone-200 flex items-center justify-between shrink-0">
          <div>
            <h2 class="font-bold text-stone-900 text-base">ตรวจสอบรายการอาหาร</h2>
            <p class="text-xs text-stone-500">
              {{ orderType === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}
              <span v-if="customerName.trim()">• คุณ{{ customerName.trim() }}</span>
            </p>
          </div>
          <button
            type="button"
            class="min-h-10 min-w-10 -mr-2 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="cartDrawerOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-4 space-y-2.5">
          <div
            v-for="item in cartItems"
            :key="item.key"
            class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <p class="font-semibold text-sm text-stone-900">{{ item.menu_name }}</p>
                <p v-if="item.selected_options.length > 0" class="text-xs text-stone-600 mt-0.5">
                  {{
                    item.selected_options
                      .map((o) => (o.price_delta > 0 ? `${o.option_name} (+${o.price_delta})` : o.option_name))
                      .join(', ')
                  }}
                </p>
                <p v-if="item.note" class="text-xs text-brand-dark font-medium mt-0.5">
                  หมายเหตุ: {{ item.note }}
                </p>
              </div>
              <span class="font-bold text-sm text-stone-900 tabular-nums shrink-0">
                {{ formatBaht(item.unit_price * item.quantity) }}
              </span>
            </div>

            <div class="flex items-center justify-between pt-1">
              <button
                type="button"
                class="min-h-9 px-2 rounded-lg text-xs text-red-600 hover:bg-red-50 flex items-center gap-1"
                @click="removeCartItem(item.key)"
              >
                <Trash2 class="w-3.5 h-3.5" />
                <span>ลบ</span>
              </button>

              <div class="flex items-center gap-1 border border-stone-300 rounded-lg bg-white">
                <button
                  type="button"
                  class="min-h-9 min-w-9 flex items-center justify-center text-stone-700 hover:bg-stone-100 rounded-l-lg"
                  @click="updateCartQty(item.key, -1)"
                >
                  <Minus class="w-3.5 h-3.5" />
                </button>
                <span class="w-7 text-center text-sm font-bold tabular-nums">{{ item.quantity }}</span>
                <button
                  type="button"
                  class="min-h-9 min-w-9 flex items-center justify-center text-stone-700 hover:bg-stone-100 rounded-r-lg"
                  @click="updateCartQty(item.key, 1)"
                >
                  <Plus class="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="border-t border-stone-200 bg-white p-4 pb-safe space-y-3 shrink-0">
          <div class="space-y-1.5">
            <span class="block text-xs font-bold text-stone-600">วิธีการจ่ายเงิน</span>
            <div
              class="grid gap-2"
              :class="paymentSettings.enable_cash && paymentSettings.enable_qr ? 'grid-cols-2' : 'grid-cols-1'"
            >
              <button
                v-if="paymentSettings.enable_cash"
                type="button"
                class="min-h-11 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition"
                :class="
                  selectedPaymentMethod === 'cash'
                    ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                    : 'bg-white border-stone-200 text-stone-700'
                "
                @click="selectedPaymentMethod = 'cash'"
              >
                <Banknote class="w-4 h-4 shrink-0" />
                <span>เงินสด</span>
              </button>
              <button
                v-if="paymentSettings.enable_qr"
                type="button"
                class="min-h-11 px-3 rounded-xl border text-xs font-bold flex items-center justify-center gap-1.5 transition"
                :class="
                  selectedPaymentMethod === 'transfer'
                    ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                    : 'bg-white border-stone-200 text-stone-700'
                "
                @click="selectedPaymentMethod = 'transfer'"
              >
                <QrCode class="w-4 h-4 shrink-0" />
                <span>สแกน QR Code</span>
              </button>
            </div>
          </div>

          <div class="flex items-center justify-between">
            <span class="font-semibold text-stone-700">ยอดรวม</span>
            <span class="text-xl font-bold text-brand tabular-nums">{{ formatBaht(cartSubtotal) }}</span>
          </div>
          <button
            type="button"
            :disabled="submitting || cartItems.length === 0"
            class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-base tabular-nums disabled:opacity-50"
            @click="submitPublicOrder"
          >
            {{
              submitting
                ? 'กำลังสร้างรายการ...'
                : selectedPaymentMethod === 'transfer'
                  ? `สั่งอาหาร & สแกนชำระเงิน • ${formatBaht(cartSubtotal)}`
                  : `สั่งอาหาร & ชำระเงินสดที่เคาน์เตอร์ • ${formatBaht(cartSubtotal)}`
            }}
          </button>
        </div>
      </div>
    </div>

    <MenuOptionSheet
      :open="Boolean(optionSheetMenu)"
      :menu="optionSheetMenu"
      :option-groups="selectedMenuOptionGroups"
      @close="optionSheetMenu = null"
      @confirm="handleOptionConfirm"
    />

    <div
      v-if="bannerMessage"
      class="fixed top-16 left-1/2 -translate-x-1/2 z-50 px-4 py-2.5 rounded-xl shadow-lg text-sm font-bold text-white pointer-events-none max-w-[90vw] text-center"
      :class="bannerMessage.type === 'error' ? 'bg-red-600' : 'bg-emerald-600'"
    >
      {{ bannerMessage.text }}
    </div>
  </div>
</template>
