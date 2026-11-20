<script setup>
import { nextTick, ref, watch } from 'vue';
import { UserCheck, X } from 'lucide-vue-next';

const props = defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  currentName: {
    type: String,
    default: '',
  },
  recentNames: {
    type: Array,
    default: () => [],
  },
  required: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits(['close', 'submit']);

const nameInput = ref('');
const inputRef = ref(null);
const errorText = ref('');

watch(
  () => props.open,
  async (isOpen) => {
    if (isOpen) {
      nameInput.value = props.currentName || '';
      errorText.value = '';
      await nextTick();
      inputRef.value?.focus();
    }
  }
);

function handleSubmit() {
  const trimmed = nameInput.value.trim();
  if (!trimmed) {
    errorText.value = 'กรุณาใส่ชื่อผู้ใช้งาน';
    return;
  }
  emit('submit', trimmed);
}

function pickRecent(name) {
  emit('submit', name);
}

function handleBackdropClick() {
  if (!props.required) {
    emit('close');
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
    @click.self="handleBackdropClick"
  >
    <div class="bg-white rounded-2xl w-full max-w-md shadow-2xl border border-stone-200 overflow-hidden">
      <div class="px-5 py-4 border-b border-stone-100 flex items-center justify-between">
        <div class="flex items-center gap-2">
          <span class="w-9 h-9 rounded-xl bg-orange-50 text-brand flex items-center justify-center">
            <UserCheck class="w-5 h-5" />
          </span>
          <div>
            <h2 class="font-bold text-stone-900 text-base">ชื่อพนักงานผู้รับออเดอร์</h2>
            <p class="text-xs text-stone-500">ใส่ชื่อเพื่อบันทึกประจำบิล (ไม่ต้องใช้รหัสผ่าน)</p>
          </div>
        </div>
        <button
          v-if="!required"
          type="button"
          class="min-h-11 min-w-11 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
          @click="$emit('close')"
        >
          <X class="w-5 h-5" />
        </button>
      </div>

      <form class="p-5 space-y-4" @submit.prevent="handleSubmit">
        <div>
          <label class="block text-sm font-semibold text-stone-700 mb-1.5" for="staff-name-input">
            ชื่อเล่น / ชื่อพนักงาน
          </label>
          <input
            id="staff-name-input"
            ref="inputRef"
            v-model="nameInput"
            type="text"
            maxlength="80"
            placeholder="เช่น มาร์ค, ฝ้าย, แคชเชียร์"
            class="w-full min-h-12 px-3.5 rounded-xl border border-stone-300 bg-white text-stone-900 text-base focus:outline-none focus:ring-2 focus:ring-brand focus:border-brand"
          />
          <p v-if="errorText" class="text-xs text-red-600 mt-1.5 font-medium">{{ errorText }}</p>
        </div>

        <div v-if="recentNames.length > 0">
          <p class="text-xs font-semibold text-stone-500 mb-2">เลือกจากชื่อที่ใช้ล่าสุด</p>
          <div class="flex flex-wrap gap-2">
            <button
              v-for="name in recentNames"
              :key="name"
              type="button"
              class="min-h-10 px-3.5 rounded-xl border text-sm font-medium transition"
              :class="
                name === currentName
                  ? 'bg-orange-50 border-brand text-brand'
                  : 'bg-stone-50 border-stone-200 text-stone-700 hover:bg-stone-100'
              "
              @click="pickRecent(name)"
            >
              {{ name }}
            </button>
          </div>
        </div>

        <button
          type="submit"
          class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-base transition active:scale-99"
        >
          เริ่มรับออเดอร์
        </button>
      </form>
    </div>
  </div>
</template>
