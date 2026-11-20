<script setup>
import {
  ChefHat,
  ClipboardList,
  LogOut,
  QrCode,
  Settings,
  ShieldCheck,
  User,
  UtensilsCrossed,
} from 'lucide-vue-next';

defineProps({
  activeTab: {
    type: String,
    required: true,
  },
  kitchenActiveCount: {
    type: Number,
    default: 0,
  },
  unpaidOrderCount: {
    type: Number,
    default: 0,
  },
  staffName: {
    type: String,
    default: '',
  },
  isAdminMode: {
    type: Boolean,
    default: false,
  },
  tapCount: {
    type: Number,
    default: 0,
  },
});

defineEmits(['changeTab', 'logoTap', 'openQrModal', 'openStaffModal', 'exitAdmin']);
</script>

<template>
  <header class="sticky top-0 z-30 bg-white border-b border-stone-200 pt-safe no-print">
    <div class="max-w-7xl mx-auto px-3 md:px-4 h-14 flex items-center justify-between gap-2">
      <button
        type="button"
        class="flex items-center gap-2 min-h-11 px-2 -ml-1 rounded-xl hover:bg-orange-50 active:scale-95 transition select-none shrink-0"
        @click="$emit('logoTap')"
      >
        <span class="w-9 h-9 rounded-xl bg-brand text-white flex items-center justify-center shadow-xs">
          <UtensilsCrossed class="w-5 h-5" />
        </span>
        <span class="text-left leading-tight hidden sm:block">
          <span class="block font-bold text-stone-900 text-sm md:text-base">YumYum POS</span>
          <span
            v-if="tapCount >= 2 && !isAdminMode"
            class="block text-[11px] font-medium text-brand"
          >
            แตะอีก {{ 5 - tapCount }} ครั้ง
          </span>
        </span>
      </button>

      <nav class="flex items-center gap-1 overflow-x-auto no-scrollbar">
        <button
          type="button"
          class="min-h-10 px-3 rounded-xl text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1.5"
          :class="
            activeTab === 'pos'
              ? 'bg-brand text-white shadow-xs'
              : 'text-stone-600 hover:bg-stone-100'
          "
          @click="$emit('changeTab', 'pos')"
        >
          <span>ขายหน้าร้าน</span>
        </button>

        <button
          type="button"
          class="min-h-10 px-3 rounded-xl text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1.5"
          :class="
            activeTab === 'kitchen'
              ? 'bg-brand text-white shadow-xs'
              : 'text-stone-600 hover:bg-stone-100'
          "
          @click="$emit('changeTab', 'kitchen')"
        >
          <ChefHat class="w-4 h-4" />
          <span>ครัว</span>
          <span
            v-if="kitchenActiveCount > 0"
            class="px-1.5 py-0.5 text-xs rounded-full font-bold tabular-nums"
            :class="
              activeTab === 'kitchen'
                ? 'bg-white text-brand'
                : 'bg-orange-100 text-brand-dark'
            "
          >
            {{ kitchenActiveCount }}
          </span>
        </button>

        <button
          type="button"
          class="min-h-10 px-3 rounded-xl text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1.5"
          :class="
            activeTab === 'orders'
              ? 'bg-brand text-white shadow-xs'
              : 'text-stone-600 hover:bg-stone-100'
          "
          @click="$emit('changeTab', 'orders')"
        >
          <ClipboardList class="w-4 h-4" />
          <span>บิล / คิว</span>
          <span
            v-if="unpaidOrderCount > 0"
            class="px-1.5 py-0.5 text-xs rounded-full font-bold tabular-nums"
            :class="
              activeTab === 'orders'
                ? 'bg-white text-brand'
                : 'bg-amber-100 text-amber-800'
            "
          >
            {{ unpaidOrderCount }}
          </span>
        </button>

        <button
          v-if="isAdminMode"
          type="button"
          class="min-h-10 px-3 rounded-xl text-xs md:text-sm font-semibold whitespace-nowrap transition flex items-center gap-1.5"
          :class="
            activeTab === 'admin'
              ? 'bg-amber-600 text-white shadow-xs'
              : 'bg-amber-50 text-amber-800 hover:bg-amber-100'
          "
          @click="$emit('changeTab', 'admin')"
        >
          <Settings class="w-4 h-4" />
          <span>จัดการร้าน</span>
        </button>
      </nav>

      <div class="flex items-center gap-1.5 shrink-0">
        <button
          type="button"
          class="min-h-10 px-2.5 md:px-3 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-brand-dark text-xs md:text-sm font-bold flex items-center gap-1.5 shrink-0"
          @click="$emit('openQrModal')"
        >
          <QrCode class="w-4 h-4 shrink-0" />
          <span class="hidden sm:inline">QR ลูกค้า</span>
        </button>

        <button
          type="button"
          class="min-h-10 px-2.5 md:px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-stone-700 text-xs md:text-sm font-medium flex items-center gap-1.5 shrink-0 max-w-28 md:max-w-36"
          @click="$emit('openStaffModal')"
        >
          <User class="w-4 h-4 text-brand shrink-0" />
          <span class="truncate">{{ staffName || 'ใส่ชื่อ' }}</span>
        </button>
      </div>
    </div>

    <div
      v-if="isAdminMode"
      class="bg-amber-50 border-t border-amber-200 px-3 md:px-4 py-1.5 text-amber-900"
    >
      <div class="max-w-7xl mx-auto flex items-center justify-between gap-2 text-xs md:text-sm">
        <div class="flex items-center gap-1.5 font-semibold">
          <ShieldCheck class="w-4 h-4 text-amber-700 shrink-0" />
          <span>โหมด Admin เปิดใช้งานอยู่</span>
        </div>
        <button
          type="button"
          class="min-h-8 px-2.5 rounded-lg bg-amber-200/70 hover:bg-amber-200 text-amber-950 font-semibold flex items-center gap-1 text-xs"
          @click="$emit('exitAdmin')"
        >
          <LogOut class="w-3.5 h-3.5" />
          <span>ออกจากโหมด Admin</span>
        </button>
      </div>
    </div>
  </header>
</template>
