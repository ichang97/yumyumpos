<script setup>
import {
  Banknote,
  CheckCircle2,
  ChefHat,
  Clock,
  Printer,
  ShoppingBag,
  Utensils,
  X,
} from 'lucide-vue-next';
import { formatBaht, formatQueueNo } from '../utils/format.js';

defineProps({
  open: {
    type: Boolean,
    default: false,
  },
  order: {
    type: Object,
    default: null,
  },
});

defineEmits(['close', 'printQueue', 'printKitchen', 'checkoutOrder']);
</script>

<template>
  <div
    v-if="open && order"
    class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
    @click.self="$emit('close')"
  >
    <div class="bg-white w-full max-w-md max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
      <div class="px-5 py-3.5 border-b border-stone-100 flex items-center justify-between shrink-0">
        <div
          class="flex items-center gap-2 font-bold text-sm"
          :class="order.status === 'paid' ? 'text-emerald-700' : 'text-amber-700'"
        >
          <CheckCircle2 v-if="order.status === 'paid'" class="w-5 h-5" />
          <Clock v-else class="w-5 h-5" />
          <span>
            {{
              order.status === 'paid'
                ? 'ชำระเงินแล้ว • ส่งเข้าครัวแล้ว'
                : 'บันทึกบิลแล้ว • รอชำระก่อนเข้าครัว'
            }}
          </span>
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
        <div class="p-5 rounded-2xl bg-orange-50 border-2 border-brand text-center space-y-1.5">
          <p class="text-xs font-bold text-brand-dark uppercase tracking-wider">บัตรคิวอาหาร</p>
          <p class="text-5xl font-bold text-brand tabular-nums tracking-tight">
            {{ formatQueueNo(order.queue_no) }}
          </p>
          <div class="flex items-center justify-center gap-2 pt-1 flex-wrap text-xs font-semibold">
            <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full bg-white text-stone-800 border border-orange-200">
              <Utensils v-if="order.order_type === 'dine_in'" class="w-3.5 h-3.5 text-brand" />
              <ShoppingBag v-else class="w-3.5 h-3.5 text-brand" />
              {{ order.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}
            </span>
            <span
              v-if="order.customer_name"
              class="px-2.5 py-1 rounded-full bg-white text-stone-800 border border-orange-200"
            >
              คุณ{{ order.customer_name }}
            </span>
            <span
              class="px-2.5 py-1 rounded-full font-bold"
              :class="
                order.status === 'paid'
                  ? 'bg-emerald-100 text-emerald-800'
                  : 'bg-amber-100 text-amber-800'
              "
            >
              {{
                order.status === 'paid'
                  ? 'ชำระเงินแล้ว'
                  : order.payment_method === 'transfer'
                    ? 'รอเช็กสลิป QR'
                    : order.payment_method === 'cash'
                      ? 'รอจ่ายเงินสด'
                      : 'รอชำระเงิน'
              }}
            </span>
          </div>
        </div>

        <div class="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-2 text-sm">
          <div class="flex justify-between text-xs text-stone-500 pb-1 border-b border-stone-200">
            <span>เลขที่บิล #{{ order.order_no }}</span>
            <span>{{ order.items.length }} รายการ</span>
          </div>

          <div
            v-for="item in order.items"
            :key="item.id"
            class="flex items-start justify-between gap-2"
          >
            <div class="min-w-0">
              <p class="font-semibold text-stone-900">{{ item.quantity }}x {{ item.menu_name }}</p>
              <p v-if="item.options.length > 0" class="text-xs text-stone-500">
                {{
                  item.options
                    .map((o) => (o.price_delta > 0 ? `${o.option_name} (+${o.price_delta})` : o.option_name))
                    .join(', ')
                }}
              </p>
              <p v-if="item.note" class="text-xs text-brand-dark font-medium">หมายเหตุ: {{ item.note }}</p>
            </div>
            <span class="font-semibold text-stone-800 tabular-nums shrink-0">
              {{ formatBaht(item.line_total) }}
            </span>
          </div>

          <div class="pt-2 border-t border-stone-200 flex justify-between font-bold text-base">
            <span>ยอดรวม</span>
            <span class="text-brand tabular-nums">{{ formatBaht(order.total_amount) }}</span>
          </div>
        </div>
      </div>

      <div class="border-t border-stone-200 bg-white p-4 pb-safe space-y-2 shrink-0">
        <div class="grid gap-2" :class="order.status === 'paid' ? 'grid-cols-2' : 'grid-cols-1'">
          <button
            type="button"
            class="min-h-11 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-1.5"
            @click="$emit('printQueue', order)"
          >
            <Printer class="w-4 h-4" />
            <span>พิมพ์บัตรคิว</span>
          </button>
          <button
            v-if="order.status === 'paid'"
            type="button"
            class="min-h-11 rounded-xl border border-stone-300 bg-stone-50 hover:bg-stone-100 text-stone-800 font-bold text-sm flex items-center justify-center gap-1.5"
            @click="$emit('printKitchen', order)"
          >
            <ChefHat class="w-4 h-4" />
            <span>พิมพ์ใบครัว</span>
          </button>
        </div>

        <div class="grid gap-2" :class="order.status === 'open' ? 'grid-cols-2' : 'grid-cols-1'">
          <button
            v-if="order.status === 'open'"
            type="button"
            class="min-h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm flex items-center justify-center gap-1.5"
            @click="$emit('checkoutOrder', order)"
          >
            <Banknote class="w-4 h-4" />
            <span>ชำระแล้ว • ส่งเข้าครัว</span>
          </button>
          <button
            type="button"
            class="min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm"
            @click="$emit('close')"
          >
            รับออเดอร์ถัดไป
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
