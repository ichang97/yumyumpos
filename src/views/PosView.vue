<script setup>
import { computed, ref } from 'vue';
import {
  ChevronUp,
  Plus,
  Search,
  ShoppingBag,
  Sparkles,
  Utensils,
  X,
} from 'lucide-vue-next';
import CartPanel from '../components/CartPanel.vue';
import CustomMenuModal from '../components/CustomMenuModal.vue';
import MenuOptionSheet from '../components/MenuOptionSheet.vue';
import { useCart } from '../composables/useCart.js';
import { formatBaht } from '../utils/format.js';

const props = defineProps({
  catalog: {
    type: Object,
    required: true,
  },
  orderType: {
    type: String,
    default: 'dine_in',
  },
  customerName: {
    type: String,
    default: '',
  },
  submitting: {
    type: Boolean,
    default: false,
  },
});

const emit = defineEmits([
  'update:orderType',
  'update:customerName',
  'sendToKitchen',
  'payAndSend',
  'notify',
]);

const cart = useCart();

const selectedCategoryId = ref(0);
const searchQuery = ref('');
const optionSheetMenu = ref(null);
const customModalOpen = ref(false);
const mobileCartOpen = ref(false);

const optionGroupsMap = computed(() => {
  const map = new Map();
  for (const group of props.catalog.option_groups || []) {
    map.set(group.id, group);
  }
  return map;
});

const filteredMenus = computed(() => {
  const query = searchQuery.value.trim().toLowerCase();
  return (props.catalog.menus || []).filter((menu) => {
    if (selectedCategoryId.value !== 0 && menu.category_id !== selectedCategoryId.value) {
      return false;
    }
    if (query && !menu.name.toLowerCase().includes(query)) {
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

function handleMenuClick(menu) {
  if (!menu.is_available) {
    return;
  }
  if (!menu.option_group_ids || menu.option_group_ids.length === 0) {
    cart.addItem({
      is_custom: false,
      menu_id: menu.id,
      menu_name: menu.name,
      base_price: menu.base_price,
      selected_options: [],
      quantity: 1,
      note: '',
    });
    emit('notify', { type: 'success', text: `เพิ่ม "${menu.name}" ลงตะกร้าแล้ว` });
    return;
  }
  optionSheetMenu.value = menu;
}

function handleOptionConfirm(entry) {
  cart.addItem(entry);
  optionSheetMenu.value = null;
  emit('notify', { type: 'success', text: `เพิ่ม "${entry.menu_name}" ลงตะกร้าแล้ว` });
}

function handleCustomConfirm(entry) {
  cart.addItem(entry);
  customModalOpen.value = false;
  emit('notify', { type: 'success', text: `เพิ่ม "${entry.menu_name}" ลงตะกร้าแล้ว` });
}

function handleSendToKitchen() {
  mobileCartOpen.value = false;
  emit('sendToKitchen');
}

function handlePayAndSend() {
  mobileCartOpen.value = false;
  emit('payAndSend');
}
</script>

<template>
  <div class="flex-1 min-h-0 flex flex-col md:grid md:grid-cols-[1fr_22rem] lg:grid-cols-[1fr_24rem]">
    <div class="flex-1 min-h-0 overflow-y-auto pb-24 md:pb-6">
      <div class="max-w-5xl mx-auto p-3 md:p-4 space-y-3.5">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="inline-flex p-1 rounded-xl bg-stone-200/70">
            <button
              type="button"
              class="min-h-10 px-3.5 rounded-lg text-sm font-bold flex items-center gap-1.5 transition"
              :class="
                orderType === 'dine_in'
                  ? 'bg-white text-brand shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              "
              @click="$emit('update:orderType', 'dine_in')"
            >
              <Utensils class="w-4 h-4" />
              <span>ทานที่ร้าน</span>
            </button>
            <button
              type="button"
              class="min-h-10 px-3.5 rounded-lg text-sm font-bold flex items-center gap-1.5 transition"
              :class="
                orderType === 'takeaway'
                  ? 'bg-white text-brand shadow-xs'
                  : 'text-stone-600 hover:text-stone-900'
              "
              @click="$emit('update:orderType', 'takeaway')"
            >
              <ShoppingBag class="w-4 h-4" />
              <span>สั่งกลับบ้าน</span>
            </button>
          </div>

          <button
            type="button"
            class="min-h-11 px-3.5 rounded-xl bg-orange-50 border border-orange-200 hover:bg-orange-100 text-brand-dark font-bold text-sm flex items-center gap-1.5 transition"
            @click="customModalOpen = true"
          >
            <Plus class="w-4 h-4" />
            <Sparkles class="w-4 h-4" />
            <span>เพิ่มเมนูเอง</span>
          </button>
        </div>

        <div class="relative">
          <Search class="w-4 h-4 text-stone-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            v-model="searchQuery"
            type="search"
            placeholder="ค้นหาชื่อเมนู..."
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
                : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
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
                : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
            "
            @click="selectedCategoryId = cat.id"
          >
            {{ cat.name }}
          </button>
        </div>

        <div
          v-if="filteredMenus.length > 0"
          class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-3 xl:grid-cols-4 gap-2.5 md:gap-3"
        >
          <button
            v-for="menu in filteredMenus"
            :key="menu.id"
            type="button"
            :disabled="!menu.is_available"
            class="text-left p-3.5 rounded-2xl border transition flex flex-col justify-between min-h-28 active:scale-98"
            :class="
              menu.is_available
                ? 'bg-white border-stone-200 hover:border-brand hover:shadow-sm'
                : 'bg-stone-100 border-stone-200 opacity-60 cursor-not-allowed'
            "
            @click="handleMenuClick(menu)"
          >
            <div class="space-y-1">
              <h3 class="font-bold text-stone-900 text-sm md:text-base leading-snug line-clamp-2">
                {{ menu.name }}
              </h3>
              <p
                v-if="menu.option_group_ids && menu.option_group_ids.length > 0"
                class="text-[11px] font-medium text-stone-500"
              >
                เลือกเพิ่มเติม {{ menu.option_group_ids.length }} ขั้นตอน
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

        <div
          v-else
          class="py-12 text-center bg-white rounded-2xl border border-stone-200 text-stone-400"
        >
          <p class="text-sm font-medium">ไม่พบเมนูที่ค้นหา</p>
        </div>
      </div>
    </div>

    <aside class="hidden md:flex md:flex-col border-l border-stone-200 bg-white min-h-0 overflow-hidden">
      <CartPanel
        :order-type="orderType"
        :customer-name="customerName"
        :cart-items="cart.items.value"
        :cart-subtotal="cart.subtotal.value"
        :submitting="submitting"
        @update:customer-name="$emit('update:customerName', $event)"
        @update-cart-qty="cart.updateQuantity"
        @remove-cart-item="cart.removeItem"
        @clear-cart="cart.clearCart"
        @send-to-kitchen="handleSendToKitchen"
        @pay-and-send="handlePayAndSend"
      />
    </aside>

    <div
      v-if="cart.itemCount.value > 0"
      class="md:hidden fixed bottom-0 inset-x-0 z-20 bg-white border-t border-stone-200 p-3 pb-safe shadow-lg no-print"
    >
      <button
        type="button"
        class="w-full min-h-12 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold flex items-center justify-between gap-3"
        @click="mobileCartOpen = true"
      >
        <div class="flex items-center gap-2 text-sm">
          <span class="px-2 py-0.5 rounded-full bg-white/20 text-xs font-bold tabular-nums">
            {{ cart.itemCount.value }} รายการ
          </span>
          <span>{{ orderType === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}</span>
        </div>
        <div class="flex items-center gap-1.5 text-base tabular-nums shrink-0">
          <span>{{ formatBaht(cart.subtotal.value) }}</span>
          <ChevronUp class="w-4 h-4" />
        </div>
      </button>
    </div>

    <div
      v-if="mobileCartOpen"
      class="md:hidden fixed inset-0 z-40 bg-stone-900/50 flex items-end no-print"
      @click.self="mobileCartOpen = false"
    >
      <div class="bg-white w-full max-h-[90dvh] h-[85dvh] rounded-t-3xl overflow-hidden flex flex-col shadow-2xl">
        <div class="px-4 py-2 border-b border-stone-100 flex items-center justify-between bg-stone-50 shrink-0">
          <span class="text-xs font-bold text-stone-500">สรุปออเดอร์</span>
          <button
            type="button"
            class="min-h-9 min-w-9 rounded-xl text-stone-500 hover:bg-stone-200 flex items-center justify-center"
            @click="mobileCartOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
        <div class="flex-1 min-h-0">
          <CartPanel
            :order-type="orderType"
            :customer-name="customerName"
            :cart-items="cart.items.value"
            :cart-subtotal="cart.subtotal.value"
            :submitting="submitting"
            @update:customer-name="$emit('update:customerName', $event)"
            @update-cart-qty="cart.updateQuantity"
            @remove-cart-item="cart.removeItem"
            @clear-cart="cart.clearCart"
            @send-to-kitchen="handleSendToKitchen"
            @pay-and-send="handlePayAndSend"
          />
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

    <CustomMenuModal
      :open="customModalOpen"
      @close="customModalOpen = false"
      @confirm="handleCustomConfirm"
    />
  </div>
</template>
