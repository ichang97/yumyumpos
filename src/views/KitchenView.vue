<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  ArrowLeft,
  ArrowRight,
  Banknote,
  Check,
  CheckCheck,
  Clock,
  Printer,
  QrCode,
  RefreshCw,
  ShoppingBag,
  Square,
  Utensils,
  Volume2,
  VolumeX,
} from 'lucide-vue-next';
import { api } from '../api/client.js';
import {
  formatBaht,
  formatQueueNo,
  formatTime,
  formatWaitMinutes,
  getWaitMinutes,
} from '../utils/format.js';
import {
  DEFAULT_SPEECH_RATE,
  SPEECH_RATE_OPTIONS,
  buildOrderSpeechText,
  clearSpeechAudioCache,
  isSpeechSupported,
  normalizeSpeechRate,
  resolveNextOrderToAnnounce,
  speakOrderAudio,
  stopSpeech,
} from '../utils/kitchenSpeech.js';
import {
  buildStationOrders,
  countActiveByStation,
  hasCustomStationItems,
} from '../utils/kitchenStation.js';

const SPEECH_RATE_STORAGE_KEY = 'yumyum_kitchen_speech_rate';
const STATION_STORAGE_KEY = 'yumyum_kitchen_station';

function hasSavedSpeechRate() {
  try {
    return Boolean(localStorage.getItem(SPEECH_RATE_STORAGE_KEY));
  } catch {
    return false;
  }
}

function loadSavedSpeechRate() {
  try {
    const saved = localStorage.getItem(SPEECH_RATE_STORAGE_KEY);
    return saved ? normalizeSpeechRate(saved) : DEFAULT_SPEECH_RATE;
  } catch {
    return DEFAULT_SPEECH_RATE;
  }
}

function loadSavedStation() {
  try {
    const saved = localStorage.getItem(STATION_STORAGE_KEY);
    if (!saved || saved === 'all' || saved === 'custom') {
      return saved || 'all';
    }
    return /^\d+$/.test(saved) ? saved : 'all';
  } catch {
    return 'all';
  }
}

const props = defineProps({
  orders: {
    type: Array,
    default: () => [],
  },
  categories: {
    type: Array,
    default: () => [],
  },
  loading: {
    type: Boolean,
    default: false,
  },
  updatingId: {
    type: Number,
    default: null,
  },
});

const emit = defineEmits(['refresh', 'updateKitchenStatus', 'checkoutOrder', 'printOrder']);

const mobileColumn = ref('pending');
const selectedStation = ref(loadSavedStation());
const soundEnabled = ref(false);
const speechRate = ref(loadSavedSpeechRate());
const speechRuntime = ref({
  source: 'web_speech',
  rate: DEFAULT_SPEECH_RATE,
  ai_studio_ready: false,
});
const nowMs = ref(Date.now());
const speechSupported = isSpeechSupported();
const effectiveSpeechSource = computed(() =>
  speechRuntime.value.source === 'ai_studio' && speechRuntime.value.ai_studio_ready
    ? 'ai_studio'
    : 'web_speech'
);
const canSpeak = computed(() => effectiveSpeechSource.value === 'ai_studio' || speechSupported);
const speakingOrderId = ref(null);
const speakingQueueNo = ref(null);
const prevStatusById = ref(new Map());
const announcedOrderIds = ref(new Set());
const initializedOrders = ref(false);

let clockTimer = null;
let audioCtx = null;
let speakDelayTimer = null;

function clearSpeakDelay() {
  if (speakDelayTimer) {
    clearTimeout(speakDelayTimer);
    speakDelayTimer = null;
  }
}

function handleStopSpeech() {
  clearSpeakDelay();
  stopSpeech();
  speakingOrderId.value = null;
  speakingQueueNo.value = null;
}

function playChime() {
  try {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      return;
    }
    if (!audioCtx) {
      audioCtx = new AudioContextCtor();
    }
    if (audioCtx.state === 'suspended') {
      audioCtx.resume();
    }
    const now = audioCtx.currentTime;
    const notes = [660, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + idx * 0.14);
      gain.gain.setValueAtTime(0.001, now + idx * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.16, now + idx * 0.14 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.14 + 0.18);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start(now + idx * 0.14);
      osc.stop(now + idx * 0.14 + 0.2);
    });
  } catch {
  }
}

async function loadSpeechRuntime() {
  try {
    const res = await api.getSpeechRuntime();
    if (res?.speech) {
      speechRuntime.value = {
        source: res.speech.source === 'ai_studio' ? 'ai_studio' : 'web_speech',
        rate: normalizeSpeechRate(res.speech.rate),
        ai_studio_ready: Boolean(res.speech.ai_studio_ready),
      };
      if (!hasSavedSpeechRate()) {
        speechRate.value = speechRuntime.value.rate;
      }
    }
  } catch {
  }
}

function fetchOrderSpeechAudio(text, signal) {
  return api.speakWithAiStudio(text, signal);
}

function announceOrder(order, { withChime = false } = {}) {
  if (!order) {
    return;
  }
  clearSpeakDelay();
  announcedOrderIds.value.add(order.id);
  const speechText = buildOrderSpeechText(order);

  const runSpeak = () => {
    const started = speakOrderAudio(speechText, {
      source: effectiveSpeechSource.value,
      rate: speechRate.value,
      fetchAudio: fetchOrderSpeechAudio,
      onLoading: () => {
        speakingOrderId.value = order.id;
        speakingQueueNo.value = order.queue_no;
      },
      onStart: () => {
        speakingOrderId.value = order.id;
        speakingQueueNo.value = order.queue_no;
      },
      onEnd: () => {
        if (speakingOrderId.value === order.id) {
          speakingOrderId.value = null;
          speakingQueueNo.value = null;
        }
      },
    });
    if (!started) {
      speakingOrderId.value = null;
      speakingQueueNo.value = null;
    }
  };

  if (withChime) {
    playChime();
    if (canSpeak.value && speechText) {
      speakDelayTimer = setTimeout(() => {
        speakDelayTimer = null;
        runSpeak();
      }, 350);
    }
    return;
  }

  runSpeak();
}

function handleSpeechRateChange(event) {
  const nextRate = normalizeSpeechRate(event.target?.value);
  speechRate.value = nextRate;
  try {
    localStorage.setItem(SPEECH_RATE_STORAGE_KEY, String(nextRate));
  } catch {
  }
  if (canSpeak.value && soundEnabled.value) {
    speakOrderAudio(`ความเร็ว ${nextRate} เท่า`, {
      source: effectiveSpeechSource.value,
      rate: nextRate,
      fetchAudio: fetchOrderSpeechAudio,
    });
  }
}

function toggleSound() {
  soundEnabled.value = !soundEnabled.value;
  if (soundEnabled.value) {
    playChime();
    if (canSpeak.value) {
      speakOrderAudio('เปิดเสียงอ่านคิวแล้ว', {
        source: effectiveSpeechSource.value,
        rate: speechRate.value,
        fetchAudio: fetchOrderSpeechAudio,
      });
    }
  } else {
    handleStopSpeech();
  }
}

function selectStation(stationKey) {
  const key = String(stationKey || 'all');
  selectedStation.value = key;
  try {
    localStorage.setItem(STATION_STORAGE_KEY, key);
  } catch {
  }
}

watch(
  () => props.categories,
  (cats) => {
    if (
      Array.isArray(cats) &&
      cats.length > 0 &&
      selectedStation.value !== 'all' &&
      selectedStation.value !== 'custom' &&
      !cats.some((cat) => String(cat.id) === selectedStation.value)
    ) {
      selectStation('all');
    }
  },
  { immediate: true }
);

const stationTabs = computed(() => {
  const tabs = [
    {
      key: 'all',
      label: 'ทั้งหมด',
      count: countActiveByStation(props.orders, 'all'),
    },
  ];
  for (const cat of props.categories || []) {
    const key = String(cat.id);
    tabs.push({
      key,
      label: cat.name,
      count: countActiveByStation(props.orders, key),
    });
  }
  if (hasCustomStationItems(props.orders) || selectedStation.value === 'custom') {
    tabs.push({
      key: 'custom',
      label: 'เมนูเอง',
      count: countActiveByStation(props.orders, 'custom'),
    });
  }
  return tabs;
});

const activeStationCategoryParam = computed(() => {
  if (selectedStation.value === 'all') {
    return null;
  }
  if (selectedStation.value === 'custom') {
    return 'custom';
  }
  return Number(selectedStation.value);
});

function emitKitchenStatus(orderId, kitchenStatus) {
  emit('updateKitchenStatus', orderId, kitchenStatus, activeStationCategoryParam.value);
}

function hasMixedItemStatuses(order) {
  const items = Array.isArray(order?.items) ? order.items : [];
  if (items.length <= 1) {
    return false;
  }
  const unique = new Set(items.map((i) => i.kitchen_status || 'pending'));
  return unique.size > 1;
}

function itemStatusLabel(status) {
  if (status === 'cooking') {
    return 'กำลังทำ';
  }
  if (status === 'ready') {
    return 'เสร็จแล้ว';
  }
  if (status === 'completed') {
    return 'ส่งแล้ว';
  }
  return 'รอทำ';
}

function itemStatusClass(status) {
  if (status === 'cooking') {
    return 'bg-sky-100 text-sky-800';
  }
  if (status === 'ready') {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (status === 'completed') {
    return 'bg-stone-200 text-stone-700';
  }
  return 'bg-orange-100 text-brand-dark';
}

const stationOrders = computed(() => buildStationOrders(props.orders, selectedStation.value));

const pendingOrders = computed(() =>
  stationOrders.value.filter((o) => o.kitchen_status === 'pending')
);

const cookingOrders = computed(() =>
  stationOrders.value.filter((o) => o.kitchen_status === 'cooking')
);

const readyOrders = computed(() =>
  stationOrders.value.filter((o) => o.kitchen_status === 'ready')
);

let lastWatchedStation = selectedStation.value;

watch(
  [selectedStation, stationOrders],
  ([station, list]) => {
    const nextList = Array.isArray(list) ? list : [];
    const nextStatusMap = new Map(nextList.map((o) => [o.id, o.kitchen_status]));
    if (station !== lastWatchedStation) {
      lastWatchedStation = station;
      handleStopSpeech();
      announcedOrderIds.value = new Set();
      prevStatusById.value = nextStatusMap;
      initializedOrders.value = true;
      return;
    }
    if (!initializedOrders.value) {
      prevStatusById.value = nextStatusMap;
      initializedOrders.value = true;
      return;
    }
    const orderToAnnounce = resolveNextOrderToAnnounce(
      prevStatusById.value,
      nextList,
      announcedOrderIds.value
    );
    prevStatusById.value = nextStatusMap;
    if (orderToAnnounce && soundEnabled.value) {
      announceOrder(orderToAnnounce, { withChime: true });
    }
  },
  { immediate: true }
);

function handleManualRefresh() {
  emit('refresh');
  loadSpeechRuntime();
}

onMounted(() => {
  emit('refresh');
  loadSpeechRuntime();
  clockTimer = setInterval(() => {
    nowMs.value = Date.now();
  }, 15000);
});

onUnmounted(() => {
  if (clockTimer) {
    clearInterval(clockTimer);
  }
  handleStopSpeech();
  clearSpeechAudioCache();
});

const columns = computed(() => [
  {
    key: 'pending',
    title: 'รอทำ',
    headerClass: 'bg-orange-50 border-orange-200 text-brand-dark',
    badgeClass: 'bg-brand text-white',
    items: pendingOrders.value,
  },
  {
    key: 'cooking',
    title: 'กำลังทำ',
    headerClass: 'bg-sky-50 border-sky-200 text-sky-900',
    badgeClass: 'bg-sky-600 text-white',
    items: cookingOrders.value,
  },
  {
    key: 'ready',
    title: 'เสร็จแล้ว / รอรับ',
    headerClass: 'bg-emerald-50 border-emerald-200 text-emerald-900',
    badgeClass: 'bg-emerald-600 text-white',
    items: readyOrders.value,
  },
]);
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col overflow-hidden">
    <div class="bg-white border-b border-stone-200 px-3 md:px-4 py-2.5 flex flex-wrap items-center justify-between gap-2 shrink-0">
      <div class="flex items-center gap-2">
        <h1 class="font-bold text-stone-900 text-sm md:text-base">กระดานครัว (Kanban)</h1>
        <span class="text-xs text-stone-500 hidden sm:inline">อัปเดตอัตโนมัติทุก 5 วินาที</span>
      </div>

      <div class="flex flex-wrap items-center gap-2">
        <button
          v-if="speakingQueueNo !== null"
          type="button"
          class="min-h-9 px-3 rounded-xl border border-orange-300 bg-orange-50 text-brand-dark text-xs font-bold flex items-center gap-1.5"
          @click="handleStopSpeech"
        >
          <Square class="w-3.5 h-3.5" />
          <span>กำลังอ่าน {{ formatQueueNo(speakingQueueNo) }}</span>
        </button>

        <button
          type="button"
          class="min-h-9 px-3 rounded-xl border text-xs font-bold flex items-center gap-1.5 transition"
          :class="
            soundEnabled
              ? 'bg-orange-50 border-brand text-brand-dark'
              : 'bg-white border-stone-200 text-stone-600 hover:bg-stone-50'
          "
          @click="toggleSound"
        >
          <Volume2 v-if="soundEnabled" class="w-4 h-4" />
          <VolumeX v-else class="w-4 h-4" />
          <span>{{ soundEnabled ? 'เสียงอ่านคิวเปิด' : 'เสียงอ่านคิวปิด' }}</span>
        </button>

        <select
          v-if="canSpeak"
          :value="speechRate"
          aria-label="ความเร็วเสียงอ่านคิว"
          class="min-h-9 px-2.5 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-bold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand"
          @change="handleSpeechRateChange"
        >
          <option v-for="rate in SPEECH_RATE_OPTIONS" :key="rate" :value="rate">
            ความเร็ว {{ rate }}x
          </option>
        </select>

        <button
          type="button"
          class="min-h-9 px-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 text-xs font-bold flex items-center gap-1.5"
          :disabled="loading"
          @click="handleManualRefresh"
        >
          <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
          <span>รีเฟรช</span>
        </button>
      </div>
    </div>

    <div class="bg-white border-b border-stone-200 px-3 md:px-4 py-2 flex items-center gap-1.5 overflow-x-auto no-scrollbar shrink-0">
      <span class="text-xs font-bold text-stone-500 mr-1 shrink-0">Station:</span>
      <button
        v-for="tab in stationTabs"
        :key="tab.key"
        type="button"
        class="min-h-9 px-3 rounded-full text-xs font-bold whitespace-nowrap flex items-center gap-1.5 border transition shrink-0"
        :class="
          selectedStation === tab.key
            ? 'bg-brand border-brand text-white shadow-2xs'
            : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
        "
        @click="selectStation(tab.key)"
      >
        <span>{{ tab.label }}</span>
        <span
          class="px-1.5 py-0.5 rounded-full text-[11px] tabular-nums"
          :class="
            selectedStation === tab.key
              ? 'bg-white text-brand'
              : tab.count > 0
                ? 'bg-orange-100 text-brand-dark'
                : 'bg-stone-200/80 text-stone-500'
          "
        >
          {{ tab.count }}
        </span>
      </button>
    </div>

    <div class="md:hidden bg-white border-b border-stone-200 px-3 py-2 grid grid-cols-3 gap-1.5 shrink-0">
      <button
        v-for="col in columns"
        :key="col.key"
        type="button"
        class="min-h-10 px-2 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 border transition"
        :class="
          mobileColumn === col.key
            ? col.headerClass
            : 'bg-stone-50 border-stone-200 text-stone-600'
        "
        @click="mobileColumn = col.key"
      >
        <span class="truncate">{{ col.title }}</span>
        <span class="px-1.5 py-0.5 rounded-full text-[11px] tabular-nums" :class="col.badgeClass">
          {{ col.items.length }}
        </span>
      </button>
    </div>

    <div class="flex-1 min-h-0 p-3 md:p-4 md:grid md:grid-cols-3 md:gap-3.5 overflow-hidden">
      <section
        v-for="col in columns"
        :key="col.key"
        class="h-full min-h-0 flex-col bg-stone-100/80 rounded-2xl border border-stone-200 overflow-hidden"
        :class="mobileColumn === col.key ? 'flex' : 'hidden md:flex'"
      >
        <div
          class="px-3.5 py-2.5 border-b flex items-center justify-between shrink-0"
          :class="col.headerClass"
        >
          <h2 class="font-bold text-sm md:text-base">{{ col.title }}</h2>
          <span class="px-2.5 py-0.5 rounded-full text-xs font-bold tabular-nums" :class="col.badgeClass">
            {{ col.items.length }}
          </span>
        </div>

        <div class="flex-1 min-h-0 overflow-y-auto p-2.5 md:p-3 space-y-2.5">
          <div
            v-if="col.items.length === 0"
            class="py-12 text-center text-stone-400 text-sm font-medium"
          >
            ไม่มีคิวในช่องนี้
          </div>

          <article
            v-for="order in col.items"
            :key="order.id"
            class="bg-white rounded-2xl border border-stone-200 p-3.5 space-y-3 shadow-2xs"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="space-y-1">
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-2xl font-bold text-stone-900 tabular-nums leading-none">
                    {{ formatQueueNo(order.queue_no) }}
                  </span>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 text-[11px] font-semibold">
                    <Utensils v-if="order.order_type === 'dine_in'" class="w-3 h-3" />
                    <ShoppingBag v-else class="w-3 h-3" />
                    {{ order.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน' }}
                  </span>
                  <span
                    v-if="order.source === 'qr'"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-[11px] font-bold"
                  >
                    <QrCode class="w-3 h-3" />
                    <span>QR</span>
                  </span>
                  <span
                    v-if="selectedStation !== 'all' && order.total_item_count > order.items.length"
                    class="px-2 py-0.5 rounded-full bg-orange-100 text-brand-dark text-[11px] font-bold tabular-nums"
                  >
                    {{ order.items.length }}/{{ order.total_item_count }} รายการ
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full text-[11px] font-bold"
                    :class="
                      order.status === 'paid'
                        ? 'bg-emerald-100 text-emerald-800'
                        : order.payment_method === 'transfer'
                          ? 'bg-sky-100 text-sky-800'
                          : 'bg-amber-100 text-amber-800'
                    "
                  >
                    {{
                      order.status === 'paid'
                        ? 'จ่ายแล้ว'
                        : order.payment_method === 'transfer'
                          ? 'รอเช็กสลิป QR'
                          : order.payment_method === 'cash'
                            ? 'รอจ่ายเงินสด'
                            : 'ยังไม่จ่าย'
                    }}
                  </span>
                </div>

                <p class="text-xs text-stone-500">
                  <span v-if="order.customer_name" class="font-semibold text-stone-700 mr-1.5">
                    คุณ{{ order.customer_name }} •
                  </span>
                  <span>สั่ง {{ formatTime(order.created_at) }}</span>
                </p>
              </div>

              <span
                class="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[11px] font-bold shrink-0 tabular-nums"
                :class="
                  getWaitMinutes(order.created_at, nowMs) >= 15
                    ? 'bg-red-100 text-red-700'
                    : 'bg-stone-100 text-stone-600'
                "
              >
                <Clock class="w-3 h-3" />
                <span>{{ formatWaitMinutes(order.created_at, nowMs) }}</span>
              </span>
            </div>

            <div class="border-t border-stone-100 pt-2.5 space-y-2">
              <div
                v-for="item in order.items"
                :key="item.id"
                class="space-y-0.5"
              >
                <div class="flex items-start justify-between gap-2">
                  <div class="font-bold text-stone-900 text-sm md:text-base leading-snug">
                    <span class="text-brand mr-1 tabular-nums">{{ item.quantity }}x</span>
                    <span>{{ item.menu_name }}</span>
                  </div>
                  <div
                    v-if="selectedStation === 'all'"
                    class="flex items-center gap-1 shrink-0 pt-0.5"
                  >
                    <span
                      v-if="item.category_name"
                      class="px-1.5 py-0.5 rounded bg-stone-100 text-stone-600 text-[10px] font-semibold"
                    >
                      {{ item.category_name }}
                    </span>
                    <span
                      v-if="hasMixedItemStatuses(order)"
                      class="px-1.5 py-0.5 rounded text-[10px] font-bold"
                      :class="itemStatusClass(item.kitchen_status)"
                    >
                      {{ itemStatusLabel(item.kitchen_status) }}
                    </span>
                  </div>
                </div>
                <p v-if="item.options.length > 0" class="text-xs text-stone-600 pl-5">
                  {{ item.options.map((o) => o.option_name).join(', ') }}
                </p>
                <p
                  v-if="item.note"
                  class="ml-5 inline-block px-2 py-0.5 rounded-md bg-orange-50 text-brand-dark text-xs font-bold"
                >
                  * {{ item.note }}
                </p>
              </div>
            </div>

            <div class="pt-2 border-t border-stone-100 flex items-center gap-2 flex-wrap">
              <template v-if="col.key === 'pending'">
                <button
                  type="button"
                  :disabled="updatingId === order.id"
                  class="flex-1 min-h-11 px-3 rounded-xl bg-sky-600 hover:bg-sky-700 text-white font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                  @click="emitKitchenStatus(order.id, 'cooking')"
                >
                  <span>เริ่มทำ</span>
                  <ArrowRight class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  :disabled="updatingId === order.id"
                  class="min-h-11 px-3 rounded-xl border border-emerald-300 bg-emerald-50 hover:bg-emerald-100 text-emerald-800 font-bold text-xs md:text-sm flex items-center justify-center gap-1 disabled:opacity-50"
                  @click="emitKitchenStatus(order.id, 'ready')"
                >
                  <Check class="w-4 h-4" />
                  <span>เสร็จเลย</span>
                </button>
                <button
                  type="button"
                  aria-label="อ่านเมนูคิวนี้"
                  title="อ่านเมนูคิวนี้"
                  class="min-h-11 min-w-11 rounded-xl border flex items-center justify-center transition"
                  :class="
                    speakingOrderId === order.id
                      ? 'bg-orange-50 border-brand text-brand-dark'
                      : 'border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600'
                  "
                  @click="announceOrder(order, { withChime: false })"
                >
                  <Volume2 class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="min-h-11 min-w-11 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 flex items-center justify-center"
                  @click="$emit('printOrder', { order, mode: 'kitchen' })"
                >
                  <Printer class="w-4 h-4" />
                </button>
              </template>

              <template v-else-if="col.key === 'cooking'">
                <button
                  type="button"
                  :disabled="updatingId === order.id"
                  class="min-h-11 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 font-bold text-xs flex items-center justify-center gap-1 disabled:opacity-50"
                  @click="emitKitchenStatus(order.id, 'pending')"
                >
                  <ArrowLeft class="w-4 h-4" />
                  <span>รอทำ</span>
                </button>
                <button
                  type="button"
                  :disabled="updatingId === order.id"
                  class="flex-1 min-h-11 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                  @click="emitKitchenStatus(order.id, 'ready')"
                >
                  <Check class="w-4 h-4" />
                  <span>ทำเสร็จแล้ว</span>
                </button>
                <button
                  type="button"
                  aria-label="อ่านเมนูคิวนี้"
                  title="อ่านเมนูคิวนี้"
                  class="min-h-11 min-w-11 rounded-xl border flex items-center justify-center transition"
                  :class="
                    speakingOrderId === order.id
                      ? 'bg-orange-50 border-brand text-brand-dark'
                      : 'border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600'
                  "
                  @click="announceOrder(order, { withChime: false })"
                >
                  <Volume2 class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="min-h-11 min-w-11 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 flex items-center justify-center"
                  @click="$emit('printOrder', { order, mode: 'kitchen' })"
                >
                  <Printer class="w-4 h-4" />
                </button>
              </template>

              <template v-else>
                <button
                  v-if="order.status === 'open'"
                  type="button"
                  class="min-h-11 px-3 rounded-xl bg-amber-500 hover:bg-amber-600 text-white font-bold text-xs md:text-sm flex items-center justify-center gap-1 tabular-nums"
                  @click="$emit('checkoutOrder', order)"
                >
                  <Banknote class="w-4 h-4" />
                  <span>คิดเงิน {{ formatBaht(order.total_amount) }}</span>
                </button>
                <button
                  type="button"
                  :disabled="updatingId === order.id"
                  class="flex-1 min-h-11 px-3 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-xs md:text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
                  @click="emitKitchenStatus(order.id, 'completed')"
                >
                  <CheckCheck class="w-4 h-4" />
                  <span>ส่งมอบแล้ว</span>
                </button>
                <button
                  type="button"
                  class="min-h-11 min-w-11 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-600 flex items-center justify-center"
                  @click="$emit('printOrder', { order, mode: 'queue' })"
                >
                  <Printer class="w-4 h-4" />
                </button>
              </template>
            </div>
          </article>
        </div>
      </section>
    </div>
  </div>
</template>
