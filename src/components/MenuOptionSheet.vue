<script setup>
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import { Check, Minus, Plus, X } from 'lucide-vue-next';
import { formatBaht } from '../utils/format.js';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  menu: {
    type: Object,
    default: null,
  },
  optionGroups: {
    type: Array,
    default: () => [],
  },
});

const emit = defineEmits(['close', 'confirm']);

const selections = ref({});
const quantity = ref(1);
const note = ref('');

watch(
  () => [props.open, props.menu?.id],
  ([isOpen]) => {
    if (isOpen && props.menu) {
      selections.value = {};
      quantity.value = 1;
      note.value = '';
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

function isSelected(groupId, optionId) {
  const list = selections.value[groupId] || [];
  return list.includes(optionId);
}

function toggleOption(group, option) {
  if (!option.is_available) {
    return;
  }
  const current = selections.value[group.id] || [];
  if (group.selection_type === 'single') {
    if (current.includes(option.id) && !group.is_required) {
      selections.value = { ...selections.value, [group.id]: [] };
    } else {
      selections.value = { ...selections.value, [group.id]: [option.id] };
    }
    return;
  }

  if (current.includes(option.id)) {
    selections.value = {
      ...selections.value,
      [group.id]: current.filter((id) => id !== option.id),
    };
  } else {
    selections.value = {
      ...selections.value,
      [group.id]: [...current, option.id],
    };
  }
}

const missingRequiredGroups = computed(() =>
  props.optionGroups.filter(
    (group) => group.is_required && !(selections.value[group.id] && selections.value[group.id].length > 0)
  )
);

const selectedOptionsList = computed(() => {
  const list = [];
  for (const group of props.optionGroups) {
    const pickedIds = selections.value[group.id] || [];
    for (const option of group.options || []) {
      if (pickedIds.includes(option.id)) {
        list.push({
          id: option.id,
          option_group_name: group.name,
          option_name: option.name,
          price_delta: option.price_delta,
        });
      }
    }
  }
  return list;
});

const unitPrice = computed(() => {
  if (!props.menu) {
    return 0;
  }
  const extra = selectedOptionsList.value.reduce((sum, opt) => sum + Number(opt.price_delta || 0), 0);
  return Math.round((Number(props.menu.base_price) + extra) * 100) / 100;
});

const lineTotal = computed(() => Math.round(unitPrice.value * quantity.value * 100) / 100);

function handleConfirm() {
  if (!props.menu || missingRequiredGroups.value.length > 0) {
    return;
  }
  emit('confirm', {
    is_custom: false,
    menu_id: props.menu.id,
    menu_name: props.menu.name,
    base_price: props.menu.base_price,
    selected_options: selectedOptionsList.value,
    quantity: quantity.value,
    note: note.value.trim(),
  });
}
</script>

<template>
  <div
    v-if="open && menu"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
    @click.self="$emit('close')"
  >
    <div class="bg-white w-full max-w-lg max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div class="px-5 py-4 border-b border-stone-200 flex items-start justify-between gap-3 shrink-0">
        <div>
          <h2 class="text-lg font-bold text-stone-900">{{ menu.name }}</h2>
          <p class="text-sm font-semibold text-brand tabular-nums">
            ราคาเริ่มต้น {{ formatBaht(menu.base_price) }}
          </p>
        </div>
        <button
          type="button"
          class="min-h-11 min-w-11 -mr-2 -mt-1 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
          @click="$emit('close')"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <div class="flex-1 overflow-y-auto p-4 md:p-5 space-y-5">
        <section
          v-for="group in optionGroups"
          :key="group.id"
          class="space-y-2.5"
        >
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-bold text-stone-800 text-sm md:text-base">{{ group.name }}</h3>
            <div class="flex items-center gap-1.5">
              <span
                v-if="group.is_required"
                class="px-2 py-0.5 rounded-full text-xs font-semibold"
                :class="
                  (selections[group.id] || []).length > 0
                    ? 'bg-emerald-100 text-emerald-800'
                    : 'bg-red-100 text-red-700'
                "
              >
                บังคับเลือก
              </span>
              <span class="px-2 py-0.5 rounded-full text-xs font-medium bg-stone-100 text-stone-600">
                {{ group.selection_type === 'single' ? 'เลือก 1 อย่าง' : 'เลือกได้หลายอย่าง' }}
              </span>
            </div>
          </div>

          <div class="flex flex-wrap gap-2">
            <button
              v-for="option in group.options"
              :key="option.id"
              type="button"
              :disabled="!option.is_available"
              class="min-h-11 px-3.5 py-2 rounded-xl border text-sm font-medium transition flex items-center gap-1.5"
              :class="[
                !option.is_available
                  ? 'bg-stone-100 border-stone-200 text-stone-400 line-through cursor-not-allowed'
                  : isSelected(group.id, option.id)
                    ? 'bg-orange-50 border-brand text-brand-dark ring-1 ring-brand font-semibold'
                    : 'bg-white border-stone-200 text-stone-700 hover:bg-stone-50',
              ]"
              @click="toggleOption(group, option)"
            >
              <Check
                v-if="isSelected(group.id, option.id)"
                class="w-4 h-4 text-brand shrink-0"
              />
              <span>{{ option.name }}</span>
              <span
                v-if="option.price_delta > 0"
                class="text-xs font-bold tabular-nums"
                :class="isSelected(group.id, option.id) ? 'text-brand-dark' : 'text-stone-500'"
              >
                +{{ formatBaht(option.price_delta) }}
              </span>
              <span v-if="!option.is_available" class="text-xs no-underline">(หมด)</span>
            </button>
          </div>
        </section>

        <section class="space-y-1.5">
          <label class="block font-bold text-stone-800 text-sm" for="option-item-note">
            หมายเหตุเพิ่มเติม (ถ้ามี)
          </label>
          <input
            id="option-item-note"
            v-model="note"
            type="text"
            maxlength="200"
            placeholder="เช่น แยกน้ำ, ไม่ใส่พริก, ไข่ไม่สุก"
            class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
        </section>
      </div>

      <div class="border-t border-stone-200 bg-white p-4 pb-safe space-y-2.5 shrink-0">
        <p
          v-if="missingRequiredGroups.length > 0"
          class="text-xs font-semibold text-red-600"
        >
          กรุณาเลือก: {{ missingRequiredGroups.map((g) => g.name).join(', ') }}
        </p>

        <div class="flex items-center gap-3">
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
            type="button"
            :disabled="missingRequiredGroups.length > 0"
            class="flex-1 min-h-12 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-base tabular-nums transition disabled:opacity-45 disabled:cursor-not-allowed"
            @click="handleConfirm"
          >
            เพิ่มลงตะกร้า • {{ formatBaht(lineTotal) }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
