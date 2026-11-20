<script setup>
import { computed, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { Banknote, CheckCircle2, ChefHat, Printer, QrCode, X } from 'lucide-vue-next';
import { formatBaht, formatQueueNo } from '../utils/format.js';
import {
  buildPromptPayPayload,
  formatPromptPayDisplay,
  isValidPromptPayId,
} from '../utils/promptpay.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  orderSummary: {
    type: Object,
    default: null,
  },
  paymentSettings: {
    type: Object,
    default: () => ({
      enable_cash: true,
      enable_qr: true,
      promptpay_id: '',
      promptpay_name: '',
      has_qr_image: false,
      qr_image_url: '',
    }),
  },
  loading: {
    type: Boolean,
    default: false,
  },
  paidOrder: {
    type: Object,
    default: null,
  },
});

const emit = defineEmits(['close', 'confirmPay', 'printReceipt', 'printKitchen']);

const discount = ref('');
const paymentMethod = ref('cash');
const received = ref('');
const qrCodeUrl = ref('');

const enableCash = computed(() => props.paymentSettings?.enable_cash !== false);
const enableQr = computed(() => props.paymentSettings?.enable_qr !== false);
const uploadedQrUrl = computed(() =>
  props.paymentSettings?.has_qr_image && props.paymentSettings?.qr_image_url
    ? props.paymentSettings.qr_image_url
    : ''
);
const hasValidPromptPay = computed(() =>
  isValidPromptPayId(props.paymentSettings?.promptpay_id)
);

function pickInitialMethod() {
  const preferred = props.orderSummary?.preferredPaymentMethod;
  if (preferred === 'cash' && enableCash.value) {
    return 'cash';
  }
  if (preferred === 'transfer' && enableQr.value) {
    return 'transfer';
  }
  if (enableCash.value) {
    return 'cash';
  }
  return 'transfer';
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen && !props.paidOrder) {
      discount.value = '';
      paymentMethod.value = pickInitialMethod();
      received.value = props.orderSummary ? String(props.orderSummary.subtotal) : '';
    }
  }
);

const subtotal = computed(() => Number(props.orderSummary?.subtotal || 0));

const discountAmount = computed(() => {
  const num = Number(discount.value);
  if (discount.value === '' || !Number.isFinite(num) || num < 0) {
    return 0;
  }
  return Math.round(num * 100) / 100;
});

const discountInvalid = computed(() => discountAmount.value > subtotal.value);

const netTotal = computed(() =>
  Math.max(0, Math.round((subtotal.value - discountAmount.value) * 100) / 100)
);

const receivedAmount = computed(() => {
  if (paymentMethod.value === 'transfer') {
    return netTotal.value;
  }
  const num = Number(received.value);
  if (received.value === '' || !Number.isFinite(num) || num < 0) {
    return 0;
  }
  return Math.round(num * 100) / 100;
});

const cashShort = computed(
  () => paymentMethod.value === 'cash' && receivedAmount.value < netTotal.value
);

const changeAmount = computed(() =>
  Math.max(0, Math.round((receivedAmount.value - netTotal.value) * 100) / 100)
);

const canConfirm = computed(
  () => !props.loading && !discountInvalid.value && !cashShort.value && subtotal.value >= 0
);

watch(
  () => [
    props.open,
    Boolean(props.paidOrder),
    paymentMethod.value,
    netTotal.value,
    uploadedQrUrl.value,
    props.paymentSettings?.promptpay_id,
  ],
  async ([isOpen, isPaid, method, total, customQrUrl, ppId]) => {
    if (!isOpen || isPaid || method !== 'transfer' || customQrUrl || !isValidPromptPayId(ppId)) {
      qrCodeUrl.value = '';
      return;
    }
    const payload = buildPromptPayPayload(ppId, total > 0 ? total : null);
    if (!payload) {
      qrCodeUrl.value = '';
      return;
    }
    try {
      qrCodeUrl.value = await QRCode.toDataURL(payload, { width: 280, margin: 2 });
    } catch {
      qrCodeUrl.value = '';
    }
  },
  { immediate: true }
);

function setQuickCash(amount) {
  received.value = String(amount);
}

function handleConfirm() {
  if (!canConfirm.value) {
    return;
  }
  emit('confirmPay', {
    discount_amount: discountAmount.value,
    payment_method: paymentMethod.value,
    received_amount: paymentMethod.value === 'cash' ? receivedAmount.value : netTotal.value,
  });
}
</script>

<template>
  <div
    v-if="open && (orderSummary || paidOrder)"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
    @click.self="$emit('close')"
  >
    <div class="bg-white w-full max-w-md max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <template v-if="!paidOrder">
        <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between shrink-0">
          <div>
            <h2 class="text-lg font-bold text-stone-900">ชำระเงิน</h2>
            <p class="text-xs font-medium text-stone-500">{{ orderSummary.title }}</p>
          </div>
          <button
            type="button"
            class="min-h-11 min-w-11 -mr-2 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="$emit('close')"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <div class="flex-1 overflow-y-auto p-5 space-y-4">
          <div class="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2">
            <div class="flex items-center justify-between text-sm text-stone-600">
              <span>ยอดอาหารรวม</span>
              <span class="font-semibold tabular-nums">{{ formatBaht(subtotal) }}</span>
            </div>

            <div class="flex items-center justify-between gap-3">
              <label class="text-sm text-stone-600 shrink-0" for="checkout-discount">
                ส่วนลด (บาท)
              </label>
              <input
                id="checkout-discount"
                v-model="discount"
                type="number"
                inputmode="decimal"
                min="0"
                placeholder="0"
                class="w-32 min-h-10 px-3 rounded-lg border border-stone-300 bg-white text-right text-sm font-semibold tabular-nums focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>
            <p v-if="discountInvalid" class="text-xs text-red-600 font-semibold text-right">
              ส่วนลดต้องไม่เกินยอดอาหาร
            </p>

            <div class="pt-2 border-t border-stone-200 flex items-center justify-between">
              <span class="font-bold text-stone-900">ยอดชำระสุทธิ</span>
              <span class="text-2xl font-bold text-brand tabular-nums">{{ formatBaht(netTotal) }}</span>
            </div>
          </div>

          <div class="space-y-2">
            <span class="block text-sm font-bold text-stone-800">วิธีการจ่ายเงิน</span>
            <div
              class="grid gap-2.5"
              :class="enableCash && enableQr ? 'grid-cols-2' : 'grid-cols-1'"
            >
              <button
                v-if="enableCash"
                type="button"
                class="min-h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 transition"
                :class="
                  paymentMethod === 'cash'
                    ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                    : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                "
                @click="paymentMethod = 'cash'"
              >
                <Banknote class="w-5 h-5" />
                <span>เงินสด</span>
              </button>

              <button
                v-if="enableQr"
                type="button"
                class="min-h-12 rounded-xl border font-bold text-sm flex items-center justify-center gap-2 transition"
                :class="
                  paymentMethod === 'transfer'
                    ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand'
                    : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50'
                "
                @click="paymentMethod = 'transfer'"
              >
                <QrCode class="w-5 h-5" />
                <span>สแกน QR Code</span>
              </button>
            </div>
          </div>

          <div v-if="paymentMethod === 'cash'" class="space-y-3">
            <div>
              <span class="block text-xs font-semibold text-stone-500 mb-1.5">ปุ่มลัดรับเงิน</span>
              <div class="grid grid-cols-4 gap-2">
                <button
                  type="button"
                  class="min-h-10 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-bold text-stone-800"
                  @click="setQuickCash(netTotal)"
                >
                  พอดี
                </button>
                <button
                  v-for="bill in [100, 500, 1000]"
                  :key="bill"
                  type="button"
                  class="min-h-10 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-bold text-stone-800 tabular-nums"
                  @click="setQuickCash(bill)"
                >
                  {{ bill }}
                </button>
              </div>
            </div>

            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="cash-received">
                รับเงินสดมา (บาท)
              </label>
              <input
                id="cash-received"
                v-model="received"
                type="number"
                inputmode="decimal"
                min="0"
                class="w-full min-h-12 px-3.5 rounded-xl border border-stone-300 bg-white text-lg font-bold tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand"
              />
            </div>

            <div
              class="p-3 rounded-xl flex items-center justify-between"
              :class="cashShort ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-800'"
            >
              <span class="text-sm font-semibold">
                {{ cashShort ? 'เงินที่รับยังไม่ครบ' : 'เงินทอน' }}
              </span>
              <span class="text-lg font-bold tabular-nums">
                {{ cashShort ? formatBaht(netTotal - receivedAmount) : formatBaht(changeAmount) }}
              </span>
            </div>
          </div>

          <div v-else class="space-y-3">
            <div
              v-if="uploadedQrUrl"
              class="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 text-center space-y-2.5"
            >
              <p class="text-xs font-bold text-sky-900">สแกน QR Code เพื่อชำระเงิน</p>
              <img
                :src="uploadedQrUrl"
                alt="QR ชำระเงินของร้าน"
                class="max-w-full max-h-72 w-auto mx-auto rounded-2xl border border-sky-200 bg-white p-2 object-contain"
              />
              <p class="text-xs font-bold text-sky-900">
                บันทึกรูป QR หรือ Capture หน้าจอสแกนผ่านแอพธนาคาร
              </p>
              <div class="space-y-0.5">
                <p class="text-xl font-bold text-brand tabular-nums">{{ formatBaht(netTotal) }}</p>
                <p v-if="paymentSettings.promptpay_name" class="text-sm font-bold text-stone-900">
                  {{ paymentSettings.promptpay_name }}
                </p>
                <p class="text-xs text-stone-600">
                  ให้ลูกค้าโอนตามยอดที่แสดง แล้วตรวจสลิปก่อนกดยืนยันรับเงิน
                </p>
              </div>
            </div>

            <div
              v-else-if="hasValidPromptPay && qrCodeUrl"
              class="p-4 rounded-2xl bg-sky-50/70 border border-sky-200 text-center space-y-2.5"
            >
              <p class="text-xs font-bold text-sky-900">สแกน QR พร้อมเพย์ (ล็อกยอดอัตโนมัติ)</p>
              <img
                :src="qrCodeUrl"
                alt="PromptPay QR Code"
                class="w-52 h-52 mx-auto rounded-2xl border border-sky-200 bg-white p-2"
              />
              <p class="text-xs font-bold text-sky-900">
                บันทึกรูป QR หรือ Capture หน้าจอสแกนผ่านแอพธนาคาร
              </p>
              <div class="space-y-0.5">
                <p class="text-xl font-bold text-brand tabular-nums">{{ formatBaht(netTotal) }}</p>
                <p v-if="paymentSettings.promptpay_name" class="text-sm font-bold text-stone-900">
                  {{ paymentSettings.promptpay_name }}
                </p>
                <p class="text-xs text-stone-600 tabular-nums">
                  พร้อมเพย์: {{ formatPromptPayDisplay(paymentSettings.promptpay_id) }}
                </p>
              </div>
            </div>

            <div
              v-else
              class="p-4 rounded-xl bg-amber-50 border border-amber-200 text-amber-900 text-sm space-y-1"
            >
              <p class="font-bold">ยังไม่ได้ตั้งค่ารูป QR หรือหมายเลขพร้อมเพย์</p>
              <p class="text-xs text-amber-800">
                สามารถอัปโหลดรูป QR ของร้านหรือตั้งค่าเลขพร้อมเพย์ได้ที่ โหมด Admin → หมวดหมู่ & ตั้งค่า QR หรือกดยืนยันรับเงินหลังเช็กสลิปได้ทันที
              </p>
            </div>
          </div>
        </div>

        <div class="border-t border-stone-200 bg-white p-4 pb-safe shrink-0">
          <button
            type="button"
            :disabled="!canConfirm"
            class="w-full min-h-12 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-base tabular-nums transition disabled:opacity-45 disabled:cursor-not-allowed"
            @click="handleConfirm"
          >
            {{ loading ? 'กำลังบันทึก...' : `ยืนยันชำระแล้ว • ส่งเข้าครัว (${formatBaht(netTotal)})` }}
          </button>
        </div>
      </template>

      <template v-else>
        <div class="p-6 text-center space-y-4">
          <div class="flex items-center justify-center gap-2 text-emerald-600 font-bold text-base">
            <CheckCircle2 class="w-6 h-6" />
            <span>ชำระเงินเรียบร้อย • ส่งคิวเข้าครัวแล้ว</span>
          </div>

          <div class="p-4 rounded-2xl bg-orange-50 border-2 border-brand space-y-1">
            <p class="text-xs font-bold text-brand-dark uppercase">เลขคิวของคุณ</p>
            <p class="text-5xl font-bold text-brand tabular-nums">
              {{ formatQueueNo(paidOrder.queue_no) }}
            </p>
            <p class="text-xs text-stone-600">
              บิล #{{ paidOrder.order_no }}
              <span v-if="paidOrder.customer_name">• คุณ{{ paidOrder.customer_name }}</span>
            </p>
          </div>

          <div class="p-4 rounded-xl bg-stone-50 border border-stone-200 text-sm space-y-2 text-left">
            <div class="flex justify-between">
              <span class="text-stone-500">ยอดชำระสุทธิ</span>
              <span class="font-bold text-stone-900 tabular-nums">{{ formatBaht(paidOrder.total_amount) }}</span>
            </div>
            <div class="flex justify-between">
              <span class="text-stone-500">ช่องทาง</span>
              <span class="font-semibold text-stone-900">
                {{ paidOrder.payment_method === 'cash' ? 'เงินสด' : 'สแกน QR Code' }}
              </span>
            </div>
            <template v-if="paidOrder.payment_method === 'cash'">
              <div class="flex justify-between">
                <span class="text-stone-500">รับเงินมา</span>
                <span class="font-semibold tabular-nums">{{ formatBaht(paidOrder.received_amount) }}</span>
              </div>
              <div class="flex justify-between text-emerald-700 font-bold">
                <span>เงินทอน</span>
                <span class="tabular-nums">{{ formatBaht(paidOrder.change_amount) }}</span>
              </div>
            </template>
          </div>

          <div class="space-y-2 pt-1 pb-safe">
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="min-h-11 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-xs md:text-sm flex items-center justify-center gap-1.5"
                @click="$emit('printReceipt', paidOrder)"
              >
                <Printer class="w-4 h-4" />
                <span>พิมพ์ใบเสร็จ & บัตรคิว</span>
              </button>
              <button
                type="button"
                class="min-h-11 rounded-xl border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 font-bold text-xs md:text-sm flex items-center justify-center gap-1.5"
                @click="$emit('printKitchen', paidOrder)"
              >
                <ChefHat class="w-4 h-4" />
                <span>พิมพ์ใบครัว</span>
              </button>
            </div>
            <button
              type="button"
              class="w-full min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm"
              @click="$emit('close')"
            >
              เสร็จสิ้น
            </button>
          </div>
        </div>
      </template>
    </div>
  </div>
</template>
