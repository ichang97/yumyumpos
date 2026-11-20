<script setup>
import { computed, nextTick, ref, watch } from 'vue';
import { Minus, Plus, Sparkles, X } from 'lucide-vue-next';
import { formatBaht } from '../utils/format.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'confirm']);

const menuName = ref('');
const price = ref('');
const quantity = ref(1);
const note = ref('');
const errorText = ref('');
const nameInputRef = ref(null);

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      menuName.value = '';
      price.value = '';
      quantity.value = 1;
      note.value = '';
      errorText.value = '';
      await nextTick();
      nameInputRef.value?.focus();
    }
  }
);

const parsedPrice = computed(() => {
  const num = Number(price.value);
  return Number.isFinite(num) && num >= 0 ? Math.round(num * 100) / 100 : 0;
});

const lineTotal = computed(() => Math.round(parsedPrice.value * quantity.value * 100) / 100);

function handleSubmit() {
  const trimmedName = menuName.value.trim();
  if (!trimmedName) {
    errorText.value = 'กรุณากรอกชื่อเมนู';
    return;
  }
  const numPrice = Number(price.value);
  if (price.value === '' || !Number.isFinite(numPrice) || numPrice < 0) {
    errorText.value = 'กรุณากรอกราคาที่ถูกต้อง';
    return;
  }

  emit('confirm', {
    is_custom: true,
    menu_id: null,
    menu_name: trimmedName,
    base_price: Math.round(numPrice * 100) / 100,
    selected_options: [],
    quantity: quantity.value,
    note: note.value.trim(),
  });
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
    @click.self="$emit('close')"
  >
    <div class="bg-white w-full max-w-md max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between shrink-0">
        <div class="flex items-center gap-2">
          <span class="w-9 h-9 rounded-xl bg-orange-50 text-brand flex items-center justify-center">
            <Sparkles class="w-5 h-5" />
          </span>
          <div>
            <h2 class="text-base font-bold text-stone-900">เพิ่มเมนูเอง</h2>
            <p class="text-xs text-stone-500">คีย์เมนูตามสั่งนอกรายการได้ทันที</p>
          </div>
        </div>
        <button
          type="button"
          class="min-h-11 min-w-11 -mr-2 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
          @click="$emit('close')"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <form class="flex-1 overflow-y-auto p-5 space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="custom-menu-name">
            ชื่ออาหาร / เมนู
          </label>
          <input
            id="custom-menu-name"
            ref="nameInputRef"
            v-model="menuName"
            type="text"
            maxlength="100"
            placeholder="เช่น ผัดพริกแกงเนื้อไข่เยี่ยวม้า"
            class="w-full min-h-12 px-3.5 rounded-xl border border-stone-300 bg-white text-base text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        <div>
          <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="custom-menu-price">
            ราคาต่อจาน (บาท)
          </label>
          <input
            id="custom-menu-price"
            v-model="price"
            type="number"
            inputmode="decimal"
            min="0"
            step="any"
            placeholder="0"
            class="w-full min-h-12 px-3.5 rounded-xl border border-stone-300 bg-white text-base font-semibold tabular-nums text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        <div>
          <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="custom-menu-note">
            หมายเหตุเพิ่มเติม (ถ้ามี)
          </label>
          <input
            id="custom-menu-note"
            v-model="note"
            type="text"
            maxlength="200"
            placeholder="เช่น เผ็ดน้อย, ไม่ใส่ถั่ว"
            class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </div>

        <p v-if="errorText" class="text-xs font-semibold text-red-600">{{ errorText }}</p>

        <div class="pt-2 pb-safe flex items-center gap-3">
          <div class="flex items-center border border-stone-300 rounded-xl bg-stone-50 shrink-0">
            <button
              type="button"
              class="min-h-11 min-w-11 flex items-center justify-center text-stone-700 hover:bg-stone-200/70 rounded-l-xl disabled:opacity-40"
              :disabled="quantity <= 1"
              @click="quantity = Math.max(1, quantity - 1)"
            >
              <Minus class="w-4 h-4" />
            </button>
            <span class="w-9 text-center font-bold text-stone-900 tabular-nums">{{ quantity }}</span>
            <button
              type="button"
              class="min-h-11 min-w-11 flex items-center justify-center text-stone-700 hover:bg-stone-200/70 rounded-r-xl"
              @click="quantity += 1"
            >
              <Plus class="w-4 h-4" />
            </button>
          </div>

          <button
            type="submit"
            class="flex-1 min-h-12 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-base tabular-nums transition"
          >
            เพิ่มเข้าบิล • {{ formatBaht(lineTotal) }}
          </button>
        </div>
      </form>
    </div>
  </div>
</template>
