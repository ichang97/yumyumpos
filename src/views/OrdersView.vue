<script setup>
import { computed, ref } from 'vue';
import {
  Ban,
  Calendar,
  CheckCircle2,
  ChefHat,
  Printer,
  QrCode,
  RefreshCw,
  ShoppingBag,
  Ticket,
  Trash2,
  Utensils,
  X,
} from 'lucide-vue-next';
import {
  formatBaht,
  formatDateTime,
  formatQueueNo,
  getBangkokDateStr,
} from '../utils/format.js';

const props = defineProps({
  openOrders: {
    type: Array,
    default: () => [],
  },
  historyOrders: {
    type: Array,
    default: () => [],
  },
  historyDate: {
    type: String,
    required: true,
  },
  loading: {
    type: Boolean,
    default: false,
  },
  isAdminMode: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:historyDate',
  'refresh',
  'checkoutOrder',
  'printOrder',
  'cancelOrder',
  'clearAllOrders',
]);

const subTab = ref('open');
const cancellingOrder = ref(null);
const cancelReason = ref('');
const cancelError = ref('');
const confirmClearOpen = ref(false);

function confirmClearAll() {
  confirmClearOpen.value = false;
  emit('clearAllOrders');
}

const displayedOrders = computed(() =>
  subTab.value === 'open' ? props.openOrders : props.historyOrders
);

function openCancelDialog(order) {
  cancellingOrder.value = order;
  cancelReason.value = '';
  cancelError.value = '';
}

function submitCancel() {
  const reason = cancelReason.value.trim();
  if (!reason) {
    cancelError.value = 'กรุณาระบุเหตุผลการยกเลิก';
    return;
  }
  emit('cancelOrder', {
    orderId: cancellingOrder.value.id,
    reason,
  });
  cancellingOrder.value = null;
}

function paymentBadgeClass(status) {
  if (status === 'open') {
    return 'bg-amber-100 text-amber-800';
  }
  if (status === 'paid') {
    return 'bg-emerald-100 text-emerald-800';
  }
  return 'bg-red-100 text-red-700';
}

function paymentLabel(order) {
  if (order.status === 'open') {
    if (order.payment_method === 'transfer') {
      return 'รอเช็กสลิป QR';
    }
    if (order.payment_method === 'cash') {
      return 'รอจ่ายเงินสด';
    }
    return 'รอชำระ';
  }
  if (order.status === 'paid') {
    return 'ชำระแล้ว';
  }
  return 'ยกเลิกแล้ว';
}

function kitchenBadgeClass(kitchenStatus) {
  if (kitchenStatus === 'pending') {
    return 'bg-orange-100 text-brand-dark';
  }
  if (kitchenStatus === 'cooking') {
    return 'bg-sky-100 text-sky-800';
  }
  if (kitchenStatus === 'ready') {
    return 'bg-emerald-100 text-emerald-800';
  }
  if (kitchenStatus === 'completed') {
    return 'bg-stone-200 text-stone-700';
  }
  return 'bg-red-100 text-red-700';
}

function kitchenLabel(kitchenStatus) {
  if (kitchenStatus === 'pending') {
    return 'รอทำ';
  }
  if (kitchenStatus === 'cooking') {
    return 'กำลังทำ';
  }
  if (kitchenStatus === 'ready') {
    return 'เสร็จแล้ว';
  }
  if (kitchenStatus === 'completed') {
    return 'ส่งมอบแล้ว';
  }
  return 'ยกเลิก';
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-5xl mx-auto p-3 md:p-5 space-y-4 pb-10">
      <div class="flex flex-wrap items-center justify-between gap-2.5">
        <div class="inline-flex p-1 rounded-xl bg-stone-200/70">
          <button
            type="button"
            class="min-h-10 px-4 rounded-lg text-sm font-bold transition flex items-center gap-1.5"
            :class="
              subTab === 'open'
                ? 'bg-white text-brand shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            "
            @click="subTab = 'open'"
          >
            <span>รอชำระเงิน</span>
            <span
              v-if="openOrders.length > 0"
              class="px-1.5 py-0.5 rounded-full text-xs bg-amber-100 text-amber-800 tabular-nums"
            >
              {{ openOrders.length }}
            </span>
          </button>

          <button
            type="button"
            class="min-h-10 px-4 rounded-lg text-sm font-bold transition"
            :class="
              subTab === 'history'
                ? 'bg-white text-brand shadow-xs'
                : 'text-stone-600 hover:text-stone-900'
            "
            @click="subTab = 'history'"
          >
            บิลทั้งหมดวันนี้
          </button>
        </div>

        <div class="flex items-center gap-2">
          <div v-if="subTab === 'history'" class="flex items-center gap-1.5">
            <div class="relative">
              <Calendar class="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                :value="historyDate"
                type="date"
                class="min-h-10 pl-9 pr-3 rounded-xl border border-stone-200 bg-white text-sm font-medium text-stone-800"
                @change="$emit('update:historyDate', $event.target.value)"
              />
            </div>
            <button
              type="button"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-xs font-semibold text-stone-700"
              @click="$emit('update:historyDate', getBangkokDateStr())"
            >
              วันนี้
            </button>
          </div>

          <span class="text-xs text-stone-500 hidden sm:inline">อัปเดตอัตโนมัติทุก 5 วินาที</span>
          <button
            v-if="isAdminMode"
            type="button"
            class="min-h-10 px-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 flex items-center justify-center gap-1.5 text-xs md:text-sm font-bold"
            @click="confirmClearOpen = true"
          >
            <Trash2 class="w-4 h-4" />
            <span>ล้างบิลและคิวทั้งหมด</span>
          </button>
          <button
            type="button"
            class="min-h-10 min-w-10 px-3 rounded-xl border border-stone-200 bg-white hover:bg-stone-50 text-stone-700 flex items-center justify-center gap-1.5 text-sm font-semibold"
            :disabled="loading"
            @click="$emit('refresh')"
          >
            <RefreshCw class="w-4 h-4" :class="{ 'animate-spin': loading }" />
            <span class="hidden sm:inline">รีเฟรช</span>
          </button>
        </div>
      </div>

      <div v-if="displayedOrders.length === 0" class="py-16 text-center bg-white rounded-2xl border border-stone-200 text-stone-400">
        <p class="text-sm font-medium">
          {{ subTab === 'open' ? 'ไม่มีบิลที่รอชำระเงิน' : 'ไม่พบบิลในวันที่เลือก' }}
        </p>
      </div>

      <div v-else class="grid grid-cols-1 md:grid-cols-2 gap-3.5">
        <article
          v-for="order in displayedOrders"
          :key="order.id"
          class="bg-white rounded-2xl border border-stone-200 p-4 flex flex-col justify-between gap-3 shadow-2xs"
        >
          <div class="space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <div class="flex items-center gap-1.5 flex-wrap">
                  <span class="text-xl font-bold text-stone-900 tabular-nums">
                    {{ formatQueueNo(order.queue_no) }}
                  </span>
                  <span class="text-xs font-medium text-stone-400 tabular-nums">#{{ order.order_no }}</span>
                  <span class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-stone-100 text-stone-700 text-xs font-semibold">
                    <Utensils v-if="order.order_type === 'dine_in'" class="w-3 h-3" />
                    <ShoppingBag v-else class="w-3 h-3" />
                    {{ order.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'กลับบ้าน' }}
                  </span>
                  <span
                    v-if="order.source === 'qr'"
                    class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-violet-100 text-violet-800 text-xs font-bold"
                  >
                    <QrCode class="w-3 h-3" />
                    <span>QR</span>
                  </span>
                  <span
                    v-if="order.status === 'open'"
                    class="px-2 py-0.5 rounded-full text-xs font-bold bg-stone-100 text-stone-600"
                  >
                    ยังไม่เข้าครัว
                  </span>
                  <span
                    v-else
                    class="px-2 py-0.5 rounded-full text-xs font-bold"
                    :class="kitchenBadgeClass(order.kitchen_status)"
                  >
                    {{ kitchenLabel(order.kitchen_status) }}
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full text-xs font-bold"
                    :class="paymentBadgeClass(order.status)"
                  >
                    {{ paymentLabel(order) }}
                  </span>
                </div>
                <p class="text-xs text-stone-500 mt-1">
                  <span v-if="order.customer_name" class="font-semibold text-stone-700">
                    คุณ{{ order.customer_name }} •
                  </span>
                  <span>{{ order.source === 'qr' ? 'ลูกค้าสั่งเอง' : `พนักงาน: ${order.staff_name}` }}</span>
                  <span> • {{ formatDateTime(order.created_at) }}</span>
                </p>
              </div>

              <span class="text-lg font-bold text-brand tabular-nums shrink-0">
                {{ formatBaht(order.total_amount) }}
              </span>
            </div>

            <div class="border-t border-stone-100 pt-2.5 space-y-1.5">
              <div
                v-for="item in order.items"
                :key="item.id"
                class="flex items-start justify-between gap-2 text-sm"
              >
                <div class="min-w-0">
                  <span class="font-semibold text-stone-800">{{ item.quantity }}x {{ item.menu_name }}</span>
                  <p v-if="item.options.length > 0" class="text-xs text-stone-500">
                    {{
                      item.options
                        .map((o) => (o.price_delta > 0 ? `${o.option_name} (+${o.price_delta})` : o.option_name))
                        .join(', ')
                    }}
                  </p>
                  <p v-if="item.note" class="text-xs text-brand-dark">หมายเหตุ: {{ item.note }}</p>
                </div>
                <span class="text-stone-700 font-medium tabular-nums shrink-0">
                  {{ formatBaht(item.line_total) }}
                </span>
              </div>
            </div>

            <div v-if="order.status === 'paid'" class="text-xs text-stone-500 flex flex-wrap gap-x-3 gap-y-1 pt-1 border-t border-stone-100">
              <span>ชำระโดย: {{ order.payment_method === 'cash' ? 'เงินสด' : 'สแกน QR Code' }}</span>
              <span v-if="order.discount_amount > 0">ส่วนลด: {{ formatBaht(order.discount_amount) }}</span>
              <span v-if="order.payment_method === 'cash'">เงินทอน: {{ formatBaht(order.change_amount) }}</span>
            </div>

            <div v-if="order.status === 'cancelled'" class="p-2.5 rounded-xl bg-red-50 text-red-700 text-xs font-medium">
              เหตุผลยกเลิก: {{ order.cancel_reason }}
            </div>
          </div>

          <div v-if="order.status !== 'cancelled'" class="flex flex-wrap gap-2 pt-2 border-t border-stone-100">
            <button
              v-if="order.status === 'open'"
              type="button"
              class="min-h-10 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1"
              @click="$emit('checkoutOrder', order)"
            >
              <CheckCircle2 class="w-4 h-4" />
              <span>ชำระแล้ว</span>
            </button>

            <button
              type="button"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 text-xs font-bold flex items-center gap-1"
              @click="$emit('printOrder', { order, mode: order.status === 'paid' ? 'receipt' : 'queue' })"
            >
              <Printer v-if="order.status === 'paid'" class="w-4 h-4" />
              <Ticket v-else class="w-4 h-4" />
              <span>{{ order.status === 'paid' ? 'ใบเสร็จ' : 'บัตรคิว' }}</span>
            </button>

            <button
              v-if="order.status === 'paid' && order.kitchen_status !== 'completed'"
              type="button"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 text-xs font-bold flex items-center gap-1"
              @click="$emit('printOrder', { order, mode: 'kitchen' })"
            >
              <ChefHat class="w-4 h-4" />
              <span>ใบครัว</span>
            </button>

            <button
              type="button"
              class="min-h-10 px-3 rounded-xl text-red-600 hover:bg-red-50 text-xs font-bold flex items-center gap-1 ml-auto"
              @click="openCancelDialog(order)"
            >
              <Ban class="w-4 h-4" />
              <span>ยกเลิกบิล</span>
            </button>
          </div>
        </article>
      </div>
    </div>

    <div
      v-if="cancellingOrder"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="cancellingOrder = null"
    >
      <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-stone-200 overflow-hidden">
        <div class="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
          <h3 class="font-bold text-stone-900">
            ยกเลิกคิว {{ formatQueueNo(cancellingOrder.queue_no) }} (#{{ cancellingOrder.order_no }})
          </h3>
          <button
            type="button"
            class="min-h-10 min-w-10 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="cancellingOrder = null"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <form class="p-5 space-y-4" @submit.prevent="submitCancel">
          <div class="flex flex-wrap gap-2">
            <button
              v-for="preset in ['คีย์รายการผิด', 'ลูกค้าเปลี่ยนใจ', 'ลูกค้าไม่มารับ']"
              :key="preset"
              type="button"
              class="min-h-9 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-semibold text-stone-700"
              @click="cancelReason = preset"
            >
              {{ preset }}
            </button>
          </div>

          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="cancel-reason-input">
              เหตุผลการยกเลิก
            </label>
            <input
              id="cancel-reason-input"
              v-model="cancelReason"
              type="text"
              maxlength="200"
              placeholder="ระบุเหตุผลการยกเลิกบิล"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm focus:outline-none focus:ring-2 focus:ring-red-500"
            />
            <p v-if="cancelError" class="text-xs text-red-600 mt-1 font-medium">{{ cancelError }}</p>
          </div>

          <div class="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              class="min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-bold text-sm"
              @click="cancellingOrder = null"
            >
              ปิด
            </button>
            <button
              type="submit"
              class="min-h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
            >
              ยืนยันยกเลิกบิล
            </button>
          </div>
        </form>
      </div>
    </div>

    <div
      v-if="confirmClearOpen"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="confirmClearOpen = false"
    >
      <div class="bg-white rounded-2xl w-full max-w-sm shadow-2xl border border-stone-200 p-5 space-y-4">
        <div class="space-y-1.5">
          <h3 class="font-bold text-stone-900 text-base">ล้างบิลและคิวทั้งหมด?</h3>
          <p class="text-xs text-stone-600 leading-relaxed">
            บิลทั้งหมด คิวในครัว และประวัติยอดขายจะถูกลบออกทั้งหมด และเลขคิวจะเริ่มนับที่ Q001 ใหม่ (เมนูอาหาร หมวดหมู่ และรูป QR ของร้านจะไม่ถูกลบ)
          </p>
        </div>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            class="min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-bold text-sm"
            @click="confirmClearOpen = false"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            class="min-h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
            @click="confirmClearAll"
          >
            ยืนยันล้างทั้งหมด
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
