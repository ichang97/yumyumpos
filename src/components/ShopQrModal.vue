<script setup>
import { onMounted, onUnmounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import { Check, Copy, ExternalLink, Printer, QrCode, X } from 'lucide-vue-next';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'printPoster', 'notify']);

const orderUrl = `${window.location.origin}/order`;
const qrDataUrl = ref('');
const copied = ref(false);

async function ensureQr() {
  if (qrDataUrl.value) {
    return;
  }
  try {
    qrDataUrl.value = await QRCode.toDataURL(orderUrl, {
      width: 320,
      margin: 2,
    });
  } catch {
  }
}

watch(
  () => props.open,
  (isOpen) => {
    if (isOpen) {
      ensureQr();
    }
  }
);

function handleKeydown(event) {
  if (event.key === 'Escape' && props.open) {
    emit('close');
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown);
});

async function copyLink() {
  try {
    await navigator.clipboard.writeText(orderUrl);
    copied.value = true;
    emit('notify', { type: 'success', text: 'คัดลอกลิงก์หน้าลูกค้าแล้ว' });
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    emit('notify', { type: 'error', text: 'ไม่สามารถคัดลอกอัตโนมัติได้' });
  }
}

function handlePrint() {
  if (!qrDataUrl.value) {
    return;
  }
  emit('printPoster', { qrDataUrl: qrDataUrl.value, orderUrl });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
    @click.self="$emit('close')"
  >
    <div class="bg-white w-full max-w-md max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between gap-2 shrink-0">
        <div class="flex items-center gap-2.5">
          <span class="w-9 h-9 rounded-xl bg-orange-50 text-brand flex items-center justify-center shrink-0">
            <QrCode class="w-5 h-5" />
          </span>
          <div>
            <h2 class="text-base font-bold text-stone-900">QR ลูกค้าสั่งอาหารเอง</h2>
            <p class="text-xs text-stone-500">
              ให้ลูกค้าสแกนจากหน้าจอนี้ หรือเปิดหน้าสั่งอาหารได้ทันที
            </p>
          </div>
        </div>
        <button
          type="button"
          class="min-h-10 min-w-10 -mr-2 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
          @click="$emit('close')"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-5 space-y-4">
        <div class="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-3">
          <img
            v-if="qrDataUrl"
            :src="qrDataUrl"
            alt="QR สั่งอาหารหน้าร้าน"
            class="w-56 h-56 mx-auto rounded-2xl border border-stone-200 bg-white p-2.5"
          />
          <div v-else class="w-56 h-56 mx-auto rounded-2xl bg-stone-100 flex items-center justify-center text-xs text-stone-400">
            กำลังสร้าง QR...
          </div>
          <p class="text-xs text-stone-600 break-all font-medium">{{ orderUrl }}</p>
        </div>

        <div class="space-y-2.5 pb-safe">
          <a
            :href="orderUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="w-full min-h-12 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-2 transition"
          >
            <ExternalLink class="w-4 h-4" />
            <span>เปิดหน้าลูกค้า (/order)</span>
          </a>

          <div class="grid grid-cols-2 gap-2.5">
            <button
              type="button"
              :disabled="!qrDataUrl"
              class="min-h-11 px-3 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
              @click="handlePrint"
            >
              <Printer class="w-4 h-4" />
              <span>พิมพ์ป้าย QR</span>
            </button>

            <button
              type="button"
              class="min-h-11 px-3 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm flex items-center justify-center gap-1.5"
              @click="copyLink"
            >
              <Check v-if="copied" class="w-4 h-4 text-emerald-600" />
              <Copy v-else class="w-4 h-4" />
              <span>{{ copied ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์' }}</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>
