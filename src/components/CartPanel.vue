<script setup>
import {
  Banknote,
  ChefHat,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  UserRound,
  Utensils,
} from 'lucide-vue-next';
import { formatBaht } from '../utils/format.js';

defineProps({
  orderType: {
    type: String,
    required: true,
  },
  customerName: {
    type: String,
    default: '',
  },
  cartItems: {
    type: Array,
    default: () => [],
  },
  cartSubtotal: {
    type: Number,
    default: 0,
  },
  submitting: {
    type: Boolean,
    default: false,
  },
});

defineEmits([
  'update:customerName',
  'updateCartQty',
  'removeCartItem',
  'clearCart',
  'sendToKitchen',
  'payAndSend',
]);
</script>

<template>
  <div class="flex flex-col h-full bg-white">
    <div class="px-4 py-3 border-b border-stone-200 flex items-center justify-between gap-2 shrink-0">
      <div class="flex items-center gap-2 min-w-0">
        <Utensils v-if="orderType === 'dine_in'" class="w-4 h-4 text-brand shrink-0" />
        <ShoppingBag v-else class="w-4 h-4 text-brand shrink-0" />
        <h2 class="font-bold text-stone-900 text-sm md:text-base truncate">
          {{ orderType === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}
        </h2>
      </div>

      <button
        v-if="cartItems.length > 0"
        type="button"
        class="min-h-9 px-2.5 rounded-xl text-red-600 hover:bg-red-50 text-xs font-semibold shrink-0"
        @click="$emit('clearCart')"
      >
        ล้างตะกร้า
      </button>
    </div>

    <div class="px-3.5 py-2.5 border-b border-stone-100 bg-stone-50/70 shrink-0">
      <div class="relative">
        <UserRound class="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
        <input
          :value="customerName"
          type="text"
          maxlength="60"
          placeholder="ชื่อลูกค้า (ไม่บังคับ เช่น คุณบี)"
          class="w-full min-h-10 pl-9 pr-3 rounded-xl border border-stone-200 bg-white text-sm text-stone-900 focus:outline-none focus:ring-2 focus:ring-brand"
          @input="$emit('update:customerName', $event.target.value)"
        />
      </div>
    </div>

    <div class="flex-1 overflow-y-auto p-3.5 space-y-2.5">
      <template v-if="cartItems.length > 0">
        <div
          v-for="item in cartItems"
          :key="item.key"
          class="p-3 rounded-xl bg-stone-50 border border-stone-200 space-y-1.5"
        >
          <div class="flex items-start justify-between gap-2">
            <div class="min-w-0">
              <div class="font-semibold text-sm text-stone-900">
                {{ item.menu_name }}
                <span
                  v-if="item.is_custom"
                  class="ml-1 text-[11px] font-semibold text-brand bg-orange-100 px-1.5 py-0.5 rounded"
                >
                  เมนูเอง
                </span>
              </div>
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
              @click="$emit('removeCartItem', item.key)"
            >
              <Trash2 class="w-3.5 h-3.5" />
              <span>ลบ</span>
            </button>

            <div class="flex items-center gap-1 border border-stone-300 rounded-lg bg-white">
              <button
                type="button"
                class="min-h-9 min-w-9 flex items-center justify-center text-stone-700 hover:bg-stone-100 rounded-l-lg"
                @click="$emit('updateCartQty', item.key, -1)"
              >
                <Minus class="w-3.5 h-3.5" />
              </button>
              <span class="w-7 text-center text-sm font-bold tabular-nums">{{ item.quantity }}</span>
              <button
                type="button"
                class="min-h-9 min-w-9 flex items-center justify-center text-stone-700 hover:bg-stone-100 rounded-r-lg"
                @click="$emit('updateCartQty', item.key, 1)"
              >
                <Plus class="w-3.5 h-3.5" />
              </button>
            </div>
          </div>
        </div>
      </template>

      <div
        v-else
        class="py-14 text-center text-stone-400 space-y-2"
      >
        <ShoppingBag class="w-10 h-10 mx-auto opacity-40" />
        <p class="text-sm font-medium">ยังไม่มีรายการอาหาร</p>
        <p class="text-xs">แตะเมนูด้านซ้ายเพื่อเพิ่มลงออเดอร์</p>
      </div>
    </div>

    <div class="border-t border-stone-200 bg-white p-3.5 pb-safe space-y-3 shrink-0">
      <div class="flex items-center justify-between text-base">
        <span class="font-semibold text-stone-700">ยอดรวม</span>
        <span class="text-xl font-bold text-stone-900 tabular-nums">
          {{ formatBaht(cartSubtotal) }}
        </span>
      </div>

      <div class="grid grid-cols-2 gap-2">
        <button
          type="button"
          :disabled="submitting || cartItems.length === 0"
          class="min-h-12 px-2.5 rounded-xl border-2 border-brand text-brand hover:bg-orange-50 font-bold text-xs md:text-sm transition flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
          @click="$emit('sendToKitchen')"
        >
          <ChefHat class="w-4 h-4 shrink-0" />
          <span>พักบิล (รอชำระ)</span>
        </button>

        <button
          type="button"
          :disabled="submitting || cartItems.length === 0"
          class="min-h-12 px-2.5 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-xs md:text-sm transition flex items-center justify-center gap-1.5 disabled:opacity-45 disabled:cursor-not-allowed"
          @click="$emit('payAndSend')"
        >
          <Banknote class="w-4 h-4 shrink-0" />
          <span>รับเงิน & ส่งครัว</span>
        </button>
      </div>
    </div>
  </div>
</template>
