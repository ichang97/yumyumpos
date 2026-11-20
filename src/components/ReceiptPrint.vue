<script setup>
import { formatDateTime, formatNumber, formatQueueNo } from '../utils/format.js';

defineProps({
  order: {
    type: Object,
    default: null,
  },
  mode: {
    type: String,
    default: 'receipt',
  },
  posterData: {
    type: Object,
    default: null,
  },
});
</script>

<template>
  <div v-if="mode === 'qr_poster' && posterData" class="print-only">
    <div class="print-poster space-y-4">
      <div class="text-2xl font-bold">YumYum POS</div>
      <div class="text-xl font-bold border-y-2 border-black py-2">
        สแกน QR สั่งอาหารด้วยตัวเอง
      </div>

      <div class="flex justify-center py-2">
        <img
          :src="posterData.qrDataUrl"
          alt="QR สั่งอาหาร"
          class="w-64 h-64 border-2 border-black p-2"
        />
      </div>

      <div class="text-sm space-y-1">
        <p class="font-bold">ขั้นตอนสั่งอาหารง่าย ๆ</p>
        <p>1. สแกน QR ด้วยกล้องมือถือ</p>
        <p>2. เลือกเมนู ตัวเลือก และกดสั่งอาหาร</p>
        <p>3. รับเลขคิวบนหน้าจอ และรอรับอาหารที่เคาน์เตอร์</p>
      </div>

      <div class="text-xs break-all pt-2 border-t border-black">
        {{ posterData.orderUrl }}
      </div>
    </div>
  </div>

  <div v-else-if="order" class="print-only">
    <div class="print-slip">
      <div class="text-center font-bold text-base">YumYum POS</div>
      <div class="text-center text-xs font-semibold">
        <template v-if="mode === 'kitchen'">ใบสั่งอาหารเข้าครัว</template>
        <template v-else-if="mode === 'queue'">บัตรคิวอาหาร</template>
        <template v-else>ใบเสร็จรับเงิน / บัตรคิว</template>
      </div>

      <div class="my-2 border-2 border-black py-1.5 text-center">
        <div class="text-[11px] font-semibold">คิวที่</div>
        <div class="text-3xl font-bold tabular-nums leading-none">
          {{ formatQueueNo(order.queue_no) }}
        </div>
        <div v-if="order.customer_name" class="text-xs font-semibold mt-1">
          คุณ{{ order.customer_name }}
        </div>
      </div>

      <div class="text-xs space-y-0.5">
        <div class="flex justify-between">
          <span>บิล: #{{ order.order_no }}</span>
          <span>
            {{ order.order_type === 'dine_in' ? 'ทานที่ร้าน' : 'สั่งกลับบ้าน' }}
            <template v-if="order.source === 'qr'"> (QR)</template>
          </span>
        </div>
        <div class="flex justify-between">
          <span>{{ order.source === 'qr' ? 'ช่องทาง: QR' : `พนักงาน: ${order.staff_name}` }}</span>
          <span>{{ formatDateTime(order.paid_at || order.created_at) }}</span>
        </div>
      </div>

      <div class="receipt-divider"></div>

      <div class="space-y-1.5 text-xs">
        <div v-for="item in order.items" :key="item.id">
          <div class="flex justify-between gap-2 font-semibold">
            <span>{{ item.quantity }}x {{ item.menu_name }}</span>
            <span v-if="mode !== 'kitchen'" class="tabular-nums">
              {{ formatNumber(item.line_total) }}
            </span>
          </div>
          <div v-if="item.options && item.options.length > 0" class="pl-3 text-[11px]">
            {{
              item.options
                .map((o) => (o.price_delta > 0 ? `${o.option_name} (+${o.price_delta})` : o.option_name))
                .join(', ')
            }}
          </div>
          <div v-if="item.note" class="pl-3 text-[11px] font-bold">
            * {{ item.note }}
          </div>
        </div>
      </div>

      <template v-if="mode !== 'kitchen'">
        <div class="receipt-divider"></div>
        <div class="space-y-0.5 text-xs">
          <div class="flex justify-between">
            <span>รวมค่าอาหาร</span>
            <span class="tabular-nums">{{ formatNumber(order.subtotal) }}</span>
          </div>
          <div v-if="order.discount_amount > 0" class="flex justify-between">
            <span>ส่วนลด</span>
            <span class="tabular-nums">-{{ formatNumber(order.discount_amount) }}</span>
          </div>
          <div class="flex justify-between font-bold text-sm pt-0.5">
            <span>ยอดสุทธิ</span>
            <span class="tabular-nums">{{ formatNumber(order.total_amount) }}</span>
          </div>
          <template v-if="order.status === 'paid'">
            <div class="flex justify-between pt-0.5">
              <span>ชำระโดย</span>
              <span>{{ order.payment_method === 'cash' ? 'เงินสด' : 'สแกน QR Code' }}</span>
            </div>
            <template v-if="order.payment_method === 'cash'">
              <div class="flex justify-between">
                <span>รับเงินมา</span>
                <span class="tabular-nums">{{ formatNumber(order.received_amount) }}</span>
              </div>
              <div class="flex justify-between font-semibold">
                <span>เงินทอน</span>
                <span class="tabular-nums">{{ formatNumber(order.change_amount) }}</span>
              </div>
            </template>
          </template>
          <div v-else class="text-center font-bold pt-1">
            *** ยังไม่ได้ชำระเงิน ***
          </div>
        </div>
        <div class="receipt-divider"></div>
        <div class="text-center text-xs pt-1">ขอบคุณที่ใช้บริการ</div>
      </template>
    </div>
  </div>
</template>
