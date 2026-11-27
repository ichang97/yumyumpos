<script setup>
import { computed, onMounted, ref, watch } from 'vue';
import QRCode from 'qrcode';
import {
  ArrowDown,
  ArrowUp,
  Banknote,
  BarChart3,
  Check,
  Copy,
  Download,
  ExternalLink,
  Layers,
  Pencil,
  Plus,
  Printer,
  QrCode,
  Search,
  SlidersHorizontal,
  Trash2,
  Upload,
  UtensilsCrossed,
  Volume2,
  X,
} from 'lucide-vue-next';
import { api } from '../api/client.js';
import AdminSpeechSettings from '../components/AdminSpeechSettings.vue';
import { formatBaht, getBangkokDateStr, shiftDateStr } from '../utils/format.js';
import { buildPromptPayPayload, isValidPromptPayId } from '../utils/promptpay.js';
import { prepareQrImageDataUrl } from '../utils/qrImage.js';

const props = defineProps({
  categories: {
    type: Array,
    default: () => [],
  },
  menus: {
    type: Array,
    default: () => [],
  },
  optionGroups: {
    type: Array,
    default: () => [],
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
});

const emit = defineEmits(['refreshAll', 'notify', 'printQrPoster']);

const adminTab = ref('menus');
const busy = ref(false);

const menuSearch = ref('');
const menuCategoryFilter = ref(0);
const menuModalOpen = ref(false);
const editingMenu = ref(null);
const menuForm = ref({
  name: '',
  category_id: 0,
  base_price: '',
  sort_order: 0,
  is_available: true,
  option_group_ids: [],
});

const groupModalOpen = ref(false);
const editingGroup = ref(null);
const groupForm = ref({
  name: '',
  selection_type: 'single',
  is_required: false,
  sort_order: 0,
});

const optionModalOpen = ref(false);
const editingOption = ref(null);
const targetGroupId = ref(null);
const optionForm = ref({
  name: '',
  price_delta: '0',
  sort_order: 0,
  is_available: true,
});

const categoryModalOpen = ref(false);
const editingCategory = ref(null);
const categoryForm = ref({
  name: '',
  sort_order: 0,
  is_active: true,
});

const confirmDialog = ref(null);
const backupFileInput = ref(null);
const exportingBackup = ref(false);
const restoringBackup = ref(false);
const pendingRestore = ref(null);

const orderUrl = `${window.location.origin}/order`;
const qrDataUrl = ref('');
const copiedLink = ref(false);

const paymentForm = ref({
  enable_cash: true,
  enable_qr: true,
  promptpay_id: '',
  promptpay_name: '',
});
const previewPromptPayQr = ref('');
const qrFileInput = ref(null);
const qrImageDraft = ref(undefined);
const processingQrImage = ref(false);

const displayedQrImage = computed(() => {
  if (qrImageDraft.value !== undefined) {
    return qrImageDraft.value;
  }
  return props.paymentSettings?.qr_image_url || '';
});

watch(
  () => props.paymentSettings,
  (val) => {
    if (val) {
      paymentForm.value = {
        enable_cash: val.enable_cash !== false,
        enable_qr: val.enable_qr !== false,
        promptpay_id: val.promptpay_id || '',
        promptpay_name: val.promptpay_name || '',
      };
      qrImageDraft.value = undefined;
    }
  },
  { immediate: true }
);

watch(
  () => [paymentForm.value.promptpay_id, adminTab.value],
  async ([ppId]) => {
    if (!isValidPromptPayId(ppId)) {
      previewPromptPayQr.value = '';
      return;
    }
    const payload = buildPromptPayPayload(ppId);
    if (!payload) {
      previewPromptPayQr.value = '';
      return;
    }
    try {
      previewPromptPayQr.value = await QRCode.toDataURL(payload, { width: 220, margin: 2 });
    } catch {
      previewPromptPayQr.value = '';
    }
  },
  { immediate: true }
);

function triggerQrUpload() {
  qrFileInput.value?.click();
}

function removeQrImage() {
  qrImageDraft.value = '';
}

async function handleQrFileChange(event) {
  const file = event.target?.files?.[0];
  if (event.target) {
    event.target.value = '';
  }
  if (!file) {
    return;
  }
  processingQrImage.value = true;
  try {
    qrImageDraft.value = await prepareQrImageDataUrl(file);
    emit('notify', { type: 'success', text: 'เตรียมรูป QR เรียบร้อย กดบันทึกเพื่อใช้งาน' });
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    processingQrImage.value = false;
  }
}

async function savePaymentSettings() {
  busy.value = true;
  try {
    const payload = {
      enable_cash: paymentForm.value.enable_cash,
      enable_qr: paymentForm.value.enable_qr,
      promptpay_id: paymentForm.value.promptpay_id,
      promptpay_name: paymentForm.value.promptpay_name,
    };
    if (qrImageDraft.value !== undefined) {
      payload.qr_image_data = qrImageDraft.value;
    }
    await api.updatePaymentSettings(payload);
    qrImageDraft.value = undefined;
    emit('notify', { type: 'success', text: 'บันทึกการตั้งค่าวิธีชำระเงินแล้ว' });
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

const todayStr = getBangkokDateStr();
const reportFrom = ref(todayStr);
const reportTo = ref(todayStr);
const reportData = ref(null);
const reportLoading = ref(false);

const categoryMap = computed(() => {
  const map = new Map();
  for (const cat of props.categories) {
    map.set(cat.id, cat);
  }
  return map;
});

const optionGroupMap = computed(() => {
  const map = new Map();
  for (const grp of props.optionGroups) {
    map.set(grp.id, grp);
  }
  return map;
});

const filteredMenus = computed(() => {
  const q = menuSearch.value.trim().toLowerCase();
  return props.menus.filter((m) => {
    if (menuCategoryFilter.value !== 0 && m.category_id !== menuCategoryFilter.value) {
      return false;
    }
    if (q && !m.name.toLowerCase().includes(q)) {
      return false;
    }
    return true;
  });
});

const unselectedOptionGroups = computed(() => {
  const selectedSet = new Set(menuForm.value.option_group_ids);
  return props.optionGroups.filter((g) => !selectedSet.has(g.id));
});

async function generateShopQr() {
  try {
    qrDataUrl.value = await QRCode.toDataURL(orderUrl, {
      width: 320,
      margin: 2,
    });
  } catch {
  }
}

async function copyOrderLink() {
  try {
    await navigator.clipboard.writeText(orderUrl);
    copiedLink.value = true;
    emit('notify', { type: 'success', text: 'คัดลอกลิงก์ QR แล้ว' });
    setTimeout(() => {
      copiedLink.value = false;
    }, 2000);
  } catch {
    emit('notify', { type: 'error', text: 'ไม่สามารถคัดลอกอัตโนมัติได้' });
  }
}

async function loadReports() {
  reportLoading.value = true;
  try {
    reportData.value = await api.getReportSummary({
      from: reportFrom.value,
      to: reportTo.value,
    });
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    reportLoading.value = false;
  }
}

watch(adminTab, (tab) => {
  if (tab === 'reports') {
    loadReports();
  }
  if (tab === 'structure' && !qrDataUrl.value) {
    generateShopQr();
  }
});

onMounted(() => {
  generateShopQr();
  if (adminTab.value === 'reports') {
    loadReports();
  }
});

function setReportPreset(daysBack) {
  const end = getBangkokDateStr();
  reportTo.value = end;
  reportFrom.value = daysBack === 0 ? end : shiftDateStr(end, -daysBack);
  loadReports();
}

function openCreateMenu() {
  editingMenu.value = null;
  menuForm.value = {
    name: '',
    category_id: props.categories[0]?.id || 0,
    base_price: '',
    sort_order: props.menus.length + 1,
    is_available: true,
    option_group_ids: [],
  };
  menuModalOpen.value = true;
}

function openEditMenu(menu) {
  editingMenu.value = menu;
  menuForm.value = {
    name: menu.name,
    category_id: menu.category_id,
    base_price: String(menu.base_price),
    sort_order: menu.sort_order,
    is_available: Boolean(menu.is_available),
    option_group_ids: [...(menu.option_group_ids || [])],
  };
  menuModalOpen.value = true;
}

function addGroupToMenuForm(groupId) {
  if (!menuForm.value.option_group_ids.includes(groupId)) {
    menuForm.value.option_group_ids.push(groupId);
  }
}

function removeGroupFromMenuForm(groupId) {
  menuForm.value.option_group_ids = menuForm.value.option_group_ids.filter((id) => id !== groupId);
}

function moveGroupInMenuForm(index, direction) {
  const list = [...menuForm.value.option_group_ids];
  const target = index + direction;
  if (target < 0 || target >= list.length) {
    return;
  }
  const temp = list[index];
  list[index] = list[target];
  list[target] = temp;
  menuForm.value.option_group_ids = list;
}

async function saveMenu() {
  busy.value = true;
  try {
    const payload = {
      name: menuForm.value.name,
      category_id: Number(menuForm.value.category_id),
      base_price: Number(menuForm.value.base_price),
      sort_order: Number(menuForm.value.sort_order) || 0,
      is_available: menuForm.value.is_available,
      option_group_ids: menuForm.value.option_group_ids,
    };
    if (editingMenu.value) {
      await api.updateMenu(editingMenu.value.id, payload);
      emit('notify', { type: 'success', text: 'อัปเดตเมนูเรียบร้อย' });
    } else {
      await api.createMenu(payload);
      emit('notify', { type: 'success', text: 'เพิ่มเมนูเรียบร้อย' });
    }
    menuModalOpen.value = false;
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

async function toggleMenuStatus(menu) {
  try {
    await api.toggleMenuAvailability(menu.id, !menu.is_available);
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  }
}

function openCreateGroup() {
  editingGroup.value = null;
  groupForm.value = {
    name: '',
    selection_type: 'single',
    is_required: false,
    sort_order: props.optionGroups.length + 1,
  };
  groupModalOpen.value = true;
}

function openEditGroup(group) {
  editingGroup.value = group;
  groupForm.value = {
    name: group.name,
    selection_type: group.selection_type,
    is_required: Boolean(group.is_required),
    sort_order: group.sort_order,
  };
  groupModalOpen.value = true;
}

async function saveGroup() {
  busy.value = true;
  try {
    const payload = {
      name: groupForm.value.name,
      selection_type: groupForm.value.selection_type,
      is_required: groupForm.value.is_required,
      sort_order: Number(groupForm.value.sort_order) || 0,
    };
    if (editingGroup.value) {
      await api.updateOptionGroup(editingGroup.value.id, payload);
      emit('notify', { type: 'success', text: 'แก้ไขกลุ่มตัวเลือกแล้ว' });
    } else {
      await api.createOptionGroup(payload);
      emit('notify', { type: 'success', text: 'สร้างกลุ่มตัวเลือกแล้ว' });
    }
    groupModalOpen.value = false;
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

function openCreateOption(group) {
  editingOption.value = null;
  targetGroupId.value = group.id;
  optionForm.value = {
    name: '',
    price_delta: '0',
    sort_order: (group.options?.length || 0) + 1,
    is_available: true,
  };
  optionModalOpen.value = true;
}

function openEditOption(option) {
  editingOption.value = option;
  targetGroupId.value = option.option_group_id;
  optionForm.value = {
    name: option.name,
    price_delta: String(option.price_delta),
    sort_order: option.sort_order,
    is_available: Boolean(option.is_available),
  };
  optionModalOpen.value = true;
}

async function saveOption() {
  busy.value = true;
  try {
    const payload = {
      name: optionForm.value.name,
      price_delta: Number(optionForm.value.price_delta) || 0,
      sort_order: Number(optionForm.value.sort_order) || 0,
      is_available: optionForm.value.is_available,
    };
    if (editingOption.value) {
      await api.updateOption(editingOption.value.id, payload);
      emit('notify', { type: 'success', text: 'อัปเดตตัวเลือกแล้ว' });
    } else {
      await api.createOption(targetGroupId.value, payload);
      emit('notify', { type: 'success', text: 'เพิ่มตัวเลือกแล้ว' });
    }
    optionModalOpen.value = false;
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

async function toggleOptionStatus(option) {
  try {
    await api.toggleOptionAvailability(option.id, !option.is_available);
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  }
}

function openCreateCategory() {
  editingCategory.value = null;
  categoryForm.value = {
    name: '',
    sort_order: props.categories.length + 1,
    is_active: true,
  };
  categoryModalOpen.value = true;
}

function openEditCategory(cat) {
  editingCategory.value = cat;
  categoryForm.value = {
    name: cat.name,
    sort_order: cat.sort_order,
    is_active: Boolean(cat.is_active),
  };
  categoryModalOpen.value = true;
}

async function saveCategory() {
  busy.value = true;
  try {
    const payload = {
      name: categoryForm.value.name,
      sort_order: Number(categoryForm.value.sort_order) || 0,
      is_active: categoryForm.value.is_active,
    };
    if (editingCategory.value) {
      await api.updateCategory(editingCategory.value.id, payload);
      emit('notify', { type: 'success', text: 'อัปเดตหมวดหมู่แล้ว' });
    } else {
      await api.createCategory(payload);
      emit('notify', { type: 'success', text: 'เพิ่มหมวดหมู่แล้ว' });
    }
    categoryModalOpen.value = false;
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

function askDelete(title, action, description = '') {
  confirmDialog.value = { title, description, action };
}

function requestClearAllOrders() {
  askDelete(
    'ล้างบิลและคิวทั้งหมด?',
    async () => {
      const res = await api.clearAllOrders();
      reportData.value = null;
      emit('notify', {
        type: 'success',
        text: `ล้างบิลและคิวทั้งหมดแล้ว (${res.deleted_orders} บิล) • เริ่มคิว Q001 ใหม่`,
      });
    },
    'บิลทั้งหมด คิวในครัว และประวัติยอดขายจะถูกลบออกทั้งหมด และเลขคิวจะเริ่มนับที่ Q001 ใหม่ (เมนูอาหาร หมวดหมู่ และรูป QR ของร้านจะไม่ถูกลบ)'
  );
}

function requestDeleteMenu(menu) {
  askDelete(`ลบเมนู "${menu.name}"?`, async () => {
    await api.deleteMenu(menu.id);
    emit('notify', { type: 'success', text: 'ลบเมนูแล้ว' });
  });
}

function requestDeleteGroup(group) {
  askDelete(`ลบกลุ่ม "${group.name}" และตัวเลือกย่อยทั้งหมด?`, async () => {
    await api.deleteOptionGroup(group.id);
    emit('notify', { type: 'success', text: 'ลบกลุ่มตัวเลือกแล้ว' });
  });
}

function requestDeleteOption(option) {
  askDelete(`ลบตัวเลือก "${option.name}"?`, async () => {
    await api.deleteOption(option.id);
    emit('notify', { type: 'success', text: 'ลบตัวเลือกแล้ว' });
  });
}

function requestDeleteCategory(category) {
  askDelete(`ลบหมวดหมู่ "${category.name}"?`, async () => {
    await api.deleteCategory(category.id);
    emit('notify', { type: 'success', text: 'ลบหมวดหมู่แล้ว' });
  });
}

async function executeConfirmDelete() {
  if (!confirmDialog.value) {
    return;
  }
  busy.value = true;
  try {
    await confirmDialog.value.action();
    confirmDialog.value = null;
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    busy.value = false;
  }
}

async function handleExportBackup() {
  if (exportingBackup.value || busy.value) {
    return;
  }
  exportingBackup.value = true;
  try {
    const backup = await api.exportBackup();
    const jsonText = JSON.stringify(backup, null, 2);
    const blob = new Blob([jsonText], { type: 'application/json;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `yumyum-pos-backup-${getBangkokDateStr()}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    emit('notify', { type: 'success', text: 'ดาวน์โหลดไฟล์สำรองข้อมูลเรียบร้อยแล้ว' });
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    exportingBackup.value = false;
  }
}

function triggerRestoreFilePicker() {
  backupFileInput.value?.click();
}

async function handleRestoreFileSelect(event) {
  const file = event.target?.files?.[0];
  if (event.target) {
    event.target.value = '';
  }
  if (!file) {
    return;
  }
  if (file.size > 5 * 1024 * 1024) {
    emit('notify', { type: 'error', text: 'ไฟล์สำรองข้อมูลมีขนาดใหญ่เกิน 5 MB' });
    return;
  }
  try {
    const rawText = await file.text();
    const parsed = JSON.parse(rawText);
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      parsed.app !== 'yumyum-pos' ||
      parsed.version !== 1 ||
      !parsed.data ||
      !Array.isArray(parsed.data.categories) ||
      !Array.isArray(parsed.data.menus) ||
      !Array.isArray(parsed.data.orders)
    ) {
      emit('notify', { type: 'error', text: 'ไฟล์ JSON ไม่ใช่รูปแบบสำรองข้อมูลของระบบ' });
      return;
    }
    const settingsList = Array.isArray(parsed.data.shop_settings)
      ? parsed.data.shop_settings
      : [];
    const hasQrImage = settingsList.some(
      (item) => item && item.key === 'qr_image_data' && Boolean(item.value)
    );
    pendingRestore.value = {
      filename: file.name,
      backup: parsed,
      summary: {
        exported_at: parsed.exported_at || '-',
        categories: parsed.data.categories.length,
        menus: parsed.data.menus.length,
        option_groups: Array.isArray(parsed.data.option_groups)
          ? parsed.data.option_groups.length
          : 0,
        orders: parsed.data.orders.length,
        has_qr_image: hasQrImage,
      },
    };
  } catch {
    emit('notify', { type: 'error', text: 'ไม่สามารถอ่านไฟล์ JSON ได้ กรุณาตรวจสอบไฟล์' });
  }
}

async function confirmRestoreBackup() {
  if (!pendingRestore.value || restoringBackup.value) {
    return;
  }
  restoringBackup.value = true;
  busy.value = true;
  try {
    const res = await api.restoreBackup(pendingRestore.value.backup);
    pendingRestore.value = null;
    reportData.value = null;
    qrImageDraft.value = undefined;
    emit('notify', {
      type: 'success',
      text: `กู้คืนข้อมูลเรียบร้อยแล้ว (เมนู ${res.counts?.menus ?? 0} รายการ • บิล ${res.counts?.orders ?? 0} บิล)`,
    });
    emit('refreshAll');
  } catch (err) {
    emit('notify', { type: 'error', text: err.message });
  } finally {
    restoringBackup.value = false;
    busy.value = false;
  }
}
</script>

<template>
  <div class="flex-1 overflow-y-auto">
    <div class="max-w-6xl mx-auto p-3 md:p-5 space-y-4 pb-12">
      <div class="flex items-center gap-2 overflow-x-auto no-scrollbar pb-0.5">
        <button
          type="button"
          class="min-h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap flex items-center gap-2 transition shrink-0"
          :class="
            adminTab === 'menus'
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          "
          @click="adminTab = 'menus'"
        >
          <UtensilsCrossed class="w-4 h-4" />
          <span>เมนูอาหาร</span>
        </button>

        <button
          type="button"
          class="min-h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap flex items-center gap-2 transition shrink-0"
          :class="
            adminTab === 'options'
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          "
          @click="adminTab = 'options'"
        >
          <SlidersHorizontal class="w-4 h-4" />
          <span>กลุ่มตัวเลือก</span>
        </button>

        <button
          type="button"
          class="min-h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap flex items-center gap-2 transition shrink-0"
          :class="
            adminTab === 'structure'
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          "
          @click="adminTab = 'structure'"
        >
          <Layers class="w-4 h-4" />
          <span>หมวดหมู่ & ตั้งค่า QR</span>
        </button>

        <button
          type="button"
          class="min-h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap flex items-center gap-2 transition shrink-0"
          :class="
            adminTab === 'speech'
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          "
          @click="adminTab = 'speech'"
        >
          <Volume2 class="w-4 h-4" />
          <span>เสียงอ่านคิว</span>
        </button>

        <button
          type="button"
          class="min-h-11 px-4 rounded-xl text-sm font-bold whitespace-nowrap flex items-center gap-2 transition shrink-0"
          :class="
            adminTab === 'reports'
              ? 'bg-stone-900 text-white'
              : 'bg-white border border-stone-200 text-stone-700 hover:bg-stone-50'
          "
          @click="adminTab = 'reports'"
        >
          <BarChart3 class="w-4 h-4" />
          <span>สรุปยอดขาย</span>
        </button>
      </div>

      <section v-if="adminTab === 'menus'" class="space-y-4">
        <div class="flex flex-wrap items-center justify-between gap-2.5">
          <div class="flex flex-wrap items-center gap-2 flex-1 min-w-60">
            <div class="relative flex-1 max-w-xs">
              <Search class="w-4 h-4 text-stone-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                v-model="menuSearch"
                type="search"
                placeholder="ค้นหาเมนู..."
                class="w-full min-h-10 pl-9 pr-3 rounded-xl border border-stone-200 bg-white text-sm"
              />
            </div>
            <select
              v-model.number="menuCategoryFilter"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-white text-sm font-medium text-stone-700"
            >
              <option :value="0">ทุกหมวดหมู่</option>
              <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                {{ cat.name }}
              </option>
            </select>
          </div>

          <button
            type="button"
            class="min-h-11 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center gap-1.5"
            @click="openCreateMenu"
          >
            <Plus class="w-4 h-4" />
            <span>เพิ่มเมนูใหม่</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          <div
            v-for="menu in filteredMenus"
            :key="menu.id"
            class="bg-white rounded-2xl border border-stone-200 p-4 flex flex-col justify-between gap-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div class="min-w-0">
                <span class="inline-block px-2 py-0.5 rounded-full bg-stone-100 text-stone-600 text-[11px] font-semibold mb-1">
                  {{ categoryMap.get(menu.category_id)?.name || '-' }}
                </span>
                <h3 class="font-bold text-stone-900 text-base">{{ menu.name }}</h3>
                <p class="text-xs text-stone-500 mt-0.5">
                  {{
                    menu.option_group_ids?.length
                      ? `ผูก ${menu.option_group_ids.length} กลุ่มตัวเลือก`
                      : 'ไม่มีตัวเลือกเสริม'
                  }}
                </p>
              </div>
              <span class="font-bold text-brand text-base tabular-nums shrink-0">
                {{ formatBaht(menu.base_price) }}
              </span>
            </div>

            <div class="flex items-center justify-between gap-2 pt-2 border-t border-stone-100">
              <button
                type="button"
                class="min-h-9 px-3 rounded-xl text-xs font-bold transition"
                :class="
                  menu.is_available
                    ? 'bg-emerald-100 text-emerald-800 hover:bg-emerald-200'
                    : 'bg-red-100 text-red-700 hover:bg-red-200'
                "
                @click="toggleMenuStatus(menu)"
              >
                {{ menu.is_available ? 'พร้อมขาย' : 'หมดชั่วคราว' }}
              </button>

              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-stone-600 hover:bg-stone-100 flex items-center justify-center"
                  @click="openEditMenu(menu)"
                >
                  <Pencil class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-red-600 hover:bg-red-50 flex items-center justify-center"
                  @click="requestDeleteMenu(menu)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section v-else-if="adminTab === 'options'" class="space-y-4">
        <div class="flex items-center justify-between gap-2">
          <p class="text-sm text-stone-600">
            สร้างกลุ่มตัวเลือกกลางแล้วนำไปผูกกับหลายเมนูได้ทันที (เช่น เส้น, น้ำ/แห้ง, เนื้อสัตว์)
          </p>
          <button
            type="button"
            class="min-h-11 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center gap-1.5 shrink-0"
            @click="openCreateGroup"
          >
            <Plus class="w-4 h-4" />
            <span>เพิ่มกลุ่มตัวเลือก</span>
          </button>
        </div>

        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div
            v-for="group in optionGroups"
            :key="group.id"
            class="bg-white rounded-2xl border border-stone-200 p-4 space-y-3"
          >
            <div class="flex items-start justify-between gap-2">
              <div>
                <h3 class="font-bold text-stone-900 text-base">{{ group.name }}</h3>
                <div class="flex items-center gap-1.5 mt-1">
                  <span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-stone-100 text-stone-700">
                    {{ group.selection_type === 'single' ? 'เลือก 1 อย่าง' : 'เลือกได้หลายอย่าง' }}
                  </span>
                  <span
                    class="px-2 py-0.5 rounded-full text-[11px] font-semibold"
                    :class="
                      group.is_required
                        ? 'bg-orange-100 text-brand-dark'
                        : 'bg-stone-100 text-stone-500'
                    "
                  >
                    {{ group.is_required ? 'บังคับเลือก' : 'ไม่บังคับ' }}
                  </span>
                </div>
              </div>

              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-stone-600 hover:bg-stone-100 flex items-center justify-center"
                  @click="openEditGroup(group)"
                >
                  <Pencil class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-red-600 hover:bg-red-50 flex items-center justify-center"
                  @click="requestDeleteGroup(group)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>

            <div class="space-y-1.5">
              <div
                v-for="opt in group.options"
                :key="opt.id"
                class="px-3 py-2 rounded-xl bg-stone-50 border border-stone-200/80 flex items-center justify-between gap-2"
              >
                <div class="min-w-0 flex items-center gap-2">
                  <span
                    class="text-sm font-medium truncate"
                    :class="opt.is_available ? 'text-stone-800' : 'text-stone-400 line-through'"
                  >
                    {{ opt.name }}
                  </span>
                  <span v-if="opt.price_delta > 0" class="text-xs font-bold text-brand tabular-nums">
                    +{{ formatBaht(opt.price_delta) }}
                  </span>
                </div>

                <div class="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    class="min-h-8 px-2 rounded-lg text-[11px] font-bold"
                    :class="
                      opt.is_available
                        ? 'bg-emerald-100 text-emerald-800'
                        : 'bg-red-100 text-red-700'
                    "
                    @click="toggleOptionStatus(opt)"
                  >
                    {{ opt.is_available ? 'มี' : 'หมด' }}
                  </button>
                  <button
                    type="button"
                    class="min-h-8 min-w-8 rounded-lg text-stone-600 hover:bg-stone-200/70 flex items-center justify-center"
                    @click="openEditOption(opt)"
                  >
                    <Pencil class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    class="min-h-8 min-w-8 rounded-lg text-red-600 hover:bg-red-100 flex items-center justify-center"
                    @click="requestDeleteOption(opt)"
                  >
                    <Trash2 class="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            </div>

            <button
              type="button"
              class="w-full min-h-10 rounded-xl border border-dashed border-stone-300 hover:border-brand hover:text-brand text-stone-600 text-xs font-bold flex items-center justify-center gap-1"
              @click="openCreateOption(group)"
            >
              <Plus class="w-4 h-4" />
              <span>เพิ่มตัวเลือกย่อย</span>
            </button>
          </div>
        </div>
      </section>

      <section v-else-if="adminTab === 'structure'" class="space-y-5">
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <div class="flex items-center justify-between gap-2">
            <h3 class="font-bold text-stone-900 text-base">หมวดหมู่อาหาร</h3>
            <button
              type="button"
              class="min-h-10 px-3 rounded-xl bg-brand hover:bg-brand-dark text-white text-xs font-bold flex items-center gap-1"
              @click="openCreateCategory"
            >
              <Plus class="w-4 h-4" />
              <span>เพิ่มหมวดหมู่</span>
            </button>
          </div>

          <div class="space-y-2">
            <div
              v-for="cat in categories"
              :key="cat.id"
              class="px-3.5 py-2.5 rounded-xl bg-stone-50 border border-stone-200 flex items-center justify-between gap-2"
            >
              <div>
                <p class="font-semibold text-sm text-stone-900">{{ cat.name }}</p>
                <p class="text-xs text-stone-500">
                  ลำดับ {{ cat.sort_order }} • {{ cat.is_active ? 'แสดงใน POS' : 'ซ่อนอยู่' }}
                </p>
              </div>
              <div class="flex items-center gap-1">
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-stone-600 hover:bg-stone-200/70 flex items-center justify-center"
                  @click="openEditCategory(cat)"
                >
                  <Pencil class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  class="min-h-9 min-w-9 rounded-xl text-red-600 hover:bg-red-100 flex items-center justify-center"
                  @click="requestDeleteCategory(cat)"
                >
                  <Trash2 class="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>

        <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-4">
          <div class="flex items-center gap-2">
            <span class="w-9 h-9 rounded-xl bg-orange-50 text-brand flex items-center justify-center">
              <QrCode class="w-5 h-5" />
            </span>
            <div>
              <h3 class="font-bold text-stone-900 text-base">ป้าย QR สำหรับลูกค้าสั่งเองหน้าร้าน</h3>
              <p class="text-xs text-stone-500">
                ลูกค้าสแกนสั่งอาหารและติดตามคิวได้ทันทีโดยไม่ติดหน้าล็อกอินพนักงาน
              </p>
            </div>
          </div>

          <div class="p-4 rounded-2xl bg-stone-50 border border-stone-200 text-center space-y-3">
            <img
              v-if="qrDataUrl"
              :src="qrDataUrl"
              alt="QR สั่งอาหารหน้าร้าน"
              class="w-48 h-48 mx-auto rounded-xl border border-stone-200 bg-white p-2"
            />
            <p class="text-xs text-stone-600 break-all font-medium">{{ orderUrl }}</p>
          </div>

          <div class="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
            <button
              type="button"
              :disabled="!qrDataUrl"
              class="min-h-11 px-3.5 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
              @click="emit('printQrPoster', { qrDataUrl, orderUrl })"
            >
              <Printer class="w-4 h-4" />
              <span>พิมพ์ป้าย QR หน้าร้าน</span>
            </button>

            <button
              type="button"
              class="min-h-11 px-3.5 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm flex items-center justify-center gap-1.5"
              @click="copyOrderLink"
            >
              <Check v-if="copiedLink" class="w-4 h-4 text-emerald-600" />
              <Copy v-else class="w-4 h-4" />
              <span>{{ copiedLink ? 'คัดลอกแล้ว' : 'คัดลอกลิงก์' }}</span>
            </button>
          </div>

          <a
            :href="orderUrl"
            target="_blank"
            rel="noopener noreferrer"
            class="w-full min-h-11 px-3.5 rounded-xl border border-orange-200 bg-orange-50 hover:bg-orange-100 text-brand-dark font-bold text-sm flex items-center justify-center gap-1.5"
          >
            <ExternalLink class="w-4 h-4" />
            <span>เปิดดูหน้าสั่งอาหารลูกค้า (/order)</span>
          </a>
        </div>

        <form class="bg-white rounded-2xl border border-stone-200 p-4 space-y-4" @submit.prevent="savePaymentSettings">
          <div class="flex items-center gap-2">
            <span class="w-9 h-9 rounded-xl bg-emerald-50 text-emerald-700 flex items-center justify-center shrink-0">
              <Banknote class="w-5 h-5" />
            </span>
            <div>
              <h3 class="font-bold text-stone-900 text-base">ตั้งค่าวิธีชำระเงิน</h3>
              <p class="text-xs text-stone-500">
                เปิด-ปิดเงินสด / สแกน QR สำหรับหน้าคิดเงินและหน้าลูกค้า
              </p>
            </div>
          </div>

          <div class="space-y-2">
            <label class="flex items-center gap-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-200 cursor-pointer select-none">
              <input v-model="paymentForm.enable_cash" type="checkbox" class="w-5 h-5 accent-brand" />
              <span class="text-sm font-semibold text-stone-800">เปิดรับชำระด้วยเงินสด</span>
            </label>

            <label class="flex items-center gap-2.5 p-2.5 rounded-xl bg-stone-50 border border-stone-200 cursor-pointer select-none">
              <input v-model="paymentForm.enable_qr" type="checkbox" class="w-5 h-5 accent-brand" />
              <span class="text-sm font-semibold text-stone-800">เปิดรับสแกน QR Code</span>
            </label>
          </div>

          <div class="p-3.5 rounded-xl bg-stone-50 border border-stone-200 space-y-3">
            <div class="flex items-start justify-between gap-2">
              <div>
                <p class="text-xs font-bold text-stone-800">รูป QR Code ชำระเงินของร้าน</p>
                <p class="text-[11px] text-stone-500 mt-0.5">
                  รองรับ PNG / JPG / WebP — หากอัปโหลดรูปไว้ ระบบจะแสดงรูปนี้เป็นหลักทั้งหน้าคิดเงินและหน้าลูกค้า
                </p>
              </div>
              <span
                v-if="qrImageDraft !== undefined"
                class="px-2 py-0.5 rounded-full bg-orange-100 text-brand-dark text-[11px] font-bold shrink-0"
              >
                รอการบันทึก
              </span>
            </div>

            <input
              ref="qrFileInput"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              class="hidden"
              @change="handleQrFileChange"
            />

            <div v-if="displayedQrImage" class="text-center">
              <img
                :src="displayedQrImage"
                alt="QR ชำระเงินของร้าน"
                class="max-w-full max-h-64 w-auto mx-auto rounded-xl border border-stone-200 bg-white p-1.5 object-contain"
              />
            </div>

            <div class="flex items-center gap-2">
              <button
                type="button"
                :disabled="processingQrImage || busy"
                class="flex-1 min-h-10 px-3 rounded-xl border border-stone-300 bg-white hover:bg-stone-100 text-stone-800 text-xs font-bold flex items-center justify-center gap-1.5 disabled:opacity-50"
                @click="triggerQrUpload"
              >
                <Upload class="w-4 h-4" />
                <span>
                  {{
                    processingQrImage
                      ? 'กำลังย่อรูป...'
                      : displayedQrImage
                        ? 'เปลี่ยนรูป QR Code'
                        : 'อัปโหลดรูป QR Code'
                  }}
                </span>
              </button>

              <button
                v-if="displayedQrImage"
                type="button"
                :disabled="busy"
                class="min-h-10 px-3 rounded-xl border border-red-200 bg-red-50 hover:bg-red-100 text-red-700 text-xs font-bold flex items-center justify-center gap-1 disabled:opacity-50"
                @click="removeQrImage"
              >
                <Trash2 class="w-4 h-4" />
                <span>ลบรูป</span>
              </button>
            </div>
          </div>

          <div class="space-y-3">
            <div>
              <label class="block text-xs font-semibold text-stone-700 mb-1" for="admin-pp-id">
                หมายเลขพร้อมเพย์สำรอง (ใช้สร้าง QR อัตโนมัติเมื่อไม่ได้อัปโหลดรูป)
              </label>
              <input
                id="admin-pp-id"
                v-model="paymentForm.promptpay_id"
                type="text"
                inputmode="numeric"
                maxlength="20"
                placeholder="เช่น 0812345678 (ไม่บังคับหากอัปโหลดรูปแล้ว)"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>

            <div>
              <label class="block text-xs font-semibold text-stone-700 mb-1" for="admin-pp-name">
                ชื่อบัญชีร้าน (แสดงใต้ QR)
              </label>
              <input
                id="admin-pp-name"
                v-model="paymentForm.promptpay_name"
                type="text"
                maxlength="80"
                placeholder="เช่น ร้านยำยำ"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm"
              />
            </div>
          </div>

          <div v-if="!displayedQrImage && previewPromptPayQr" class="p-3 rounded-xl bg-sky-50 border border-sky-200 text-center space-y-1.5">
            <p class="text-[11px] font-bold text-sky-900">ตัวอย่าง QR พร้อมเพย์</p>
            <img
              :src="previewPromptPayQr"
              alt="PromptPay Preview"
              class="w-36 h-36 mx-auto rounded-xl border border-sky-200 bg-white p-1.5"
            />
          </div>

          <button
            type="submit"
            :disabled="busy || processingQrImage"
            class="w-full min-h-11 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm disabled:opacity-50"
          >
            {{ busy ? 'กำลังบันทึก...' : 'บันทึกการตั้งค่าชำระเงิน' }}
          </button>
        </form>
        </div>

        <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
          <div class="space-y-0.5">
            <h3 class="font-bold text-stone-900 text-sm md:text-base">
              สำรองและกู้คืนข้อมูล (Backup / Restore JSON)
            </h3>
            <p class="text-xs text-stone-500">
              ส่งออกหรือกู้คืนข้อมูลทั้งหมดในระบบเป็นไฟล์ JSON (หมวดหมู่, เมนูอาหาร, กลุ่มตัวเลือก, บิลและประวัติยอดขาย, การตั้งค่าชำระเงิน และรูป QR)
            </p>
          </div>

          <input
            ref="backupFileInput"
            type="file"
            accept="application/json,.json"
            class="hidden"
            @change="handleRestoreFileSelect"
          />

          <div class="flex flex-col sm:flex-row gap-2.5">
            <button
              type="button"
              :disabled="exportingBackup || restoringBackup || busy"
              class="flex-1 min-h-11 px-4 rounded-xl bg-stone-900 hover:bg-stone-800 text-white font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
              @click="handleExportBackup"
            >
              <Download class="w-4 h-4" />
              <span>{{ exportingBackup ? 'กำลังส่งออก...' : 'Export สำรองข้อมูล (.json)' }}</span>
            </button>

            <button
              type="button"
              :disabled="exportingBackup || restoringBackup || busy"
              class="flex-1 min-h-11 px-4 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-800 font-bold text-sm flex items-center justify-center gap-1.5 disabled:opacity-50"
              @click="triggerRestoreFilePicker"
            >
              <Upload class="w-4 h-4" />
              <span>Restore กู้คืนจากไฟล์ (.json)</span>
            </button>
          </div>
        </div>

        <div class="bg-red-50/70 rounded-2xl border border-red-200 p-4 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div class="space-y-0.5">
            <h3 class="font-bold text-red-900 text-sm md:text-base">
              ล้างบิลและคิวทั้งหมด (รีเซ็ตเป็น Q001)
            </h3>
            <p class="text-xs text-red-800/80">
              ลบบิล คิวในครัว และประวัติการขายทั้งหมดเพื่อเริ่มรอบใหม่ — เมนูอาหาร ตัวเลือก และรูป QR ชำระเงินของร้านจะยังคงอยู่ครบ
            </p>
          </div>
          <button
            type="button"
            :disabled="busy"
            class="min-h-11 px-4 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm flex items-center justify-center gap-1.5 shrink-0 disabled:opacity-50"
            @click="requestClearAllOrders"
          >
            <Trash2 class="w-4 h-4" />
            <span>ล้างบิลและคิวทั้งหมด</span>
          </button>
        </div>
      </section>

      <section v-else-if="adminTab === 'speech'">
        <AdminSpeechSettings @notify="emit('notify', $event)" />
      </section>

      <section v-else-if="adminTab === 'reports'" class="space-y-4">
        <div class="bg-white rounded-2xl border border-stone-200 p-4 flex flex-wrap items-center justify-between gap-3">
          <div class="flex flex-wrap items-center gap-2">
            <input
              v-model="reportFrom"
              type="date"
              class="min-h-10 px-3 rounded-xl border border-stone-200 text-sm"
            />
            <span class="text-stone-400 text-sm">ถึง</span>
            <input
              v-model="reportTo"
              type="date"
              class="min-h-10 px-3 rounded-xl border border-stone-200 text-sm"
            />
            <button
              type="button"
              class="min-h-10 px-4 rounded-xl bg-brand hover:bg-brand-dark text-white text-sm font-bold"
              :disabled="reportLoading"
              @click="loadReports"
            >
              ดูยอดขาย
            </button>
          </div>

          <div class="flex items-center gap-2">
            <button
              type="button"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-bold text-stone-700"
              @click="setReportPreset(0)"
            >
              วันนี้
            </button>
            <button
              type="button"
              class="min-h-10 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-bold text-stone-700"
              @click="setReportPreset(6)"
            >
              7 วันล่าสุด
            </button>
          </div>
        </div>

        <template v-if="reportData">
          <div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div class="bg-white rounded-2xl border border-stone-200 p-4">
              <p class="text-xs font-semibold text-stone-500">ยอดขายรวม</p>
              <p class="text-2xl font-bold text-brand tabular-nums mt-1">
                {{ formatBaht(reportData.summary.total_sales) }}
              </p>
            </div>
            <div class="bg-white rounded-2xl border border-stone-200 p-4">
              <p class="text-xs font-semibold text-stone-500">บิลที่ชำระแล้ว</p>
              <p class="text-2xl font-bold text-stone-900 tabular-nums mt-1">
                {{ reportData.summary.order_count }} บิล
              </p>
            </div>
            <div class="bg-white rounded-2xl border border-stone-200 p-4">
              <p class="text-xs font-semibold text-stone-500">เงินสด</p>
              <p class="text-2xl font-bold text-emerald-700 tabular-nums mt-1">
                {{ formatBaht(reportData.summary.cash_sales) }}
              </p>
            </div>
            <div class="bg-white rounded-2xl border border-stone-200 p-4">
              <p class="text-xs font-semibold text-stone-500">โอนเงิน</p>
              <p class="text-2xl font-bold text-sky-700 tabular-nums mt-1">
                {{ formatBaht(reportData.summary.transfer_sales) }}
              </p>
            </div>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div class="bg-white rounded-2xl border border-stone-200 p-4 flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold text-stone-500">ยอดขายจากพนักงานหน้าร้าน</p>
                <p class="text-xl font-bold text-stone-900 tabular-nums mt-0.5">
                  {{ formatBaht(reportData.summary.staff_sales) }}
                </p>
              </div>
              <span class="px-3 py-1 rounded-full bg-stone-100 text-stone-700 text-xs font-bold tabular-nums">
                {{ reportData.summary.staff_order_count }} บิล
              </span>
            </div>

            <div class="bg-white rounded-2xl border border-stone-200 p-4 flex items-center justify-between">
              <div>
                <p class="text-xs font-semibold text-stone-500">ยอดขายจากลูกค้าสแกน QR</p>
                <p class="text-xl font-bold text-violet-700 tabular-nums mt-0.5">
                  {{ formatBaht(reportData.summary.qr_sales) }}
                </p>
              </div>
              <span class="px-3 py-1 rounded-full bg-violet-100 text-violet-800 text-xs font-bold tabular-nums">
                {{ reportData.summary.qr_order_count }} บิล
              </span>
            </div>
          </div>

          <div class="bg-white rounded-2xl border border-stone-200 px-4 py-3 flex flex-wrap gap-4 text-xs md:text-sm text-stone-600">
            <span>ส่วนลดรวม: <strong class="text-stone-900 tabular-nums">{{ formatBaht(reportData.summary.total_discount) }}</strong></span>
            <span>บิลรอชำระ (ทั้งหมด): <strong class="text-amber-700 tabular-nums">{{ reportData.summary.open_count }} บิล ({{ formatBaht(reportData.summary.open_amount) }})</strong></span>
            <span>บิลยกเลิก: <strong class="text-red-700 tabular-nums">{{ reportData.summary.cancelled_count }} บิล</strong></span>
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
              <h3 class="font-bold text-stone-900 text-base">เมนูขายดี 10 อันดับ</h3>
              <p v-if="reportData.top_menus.length === 0" class="text-sm text-stone-400 py-6 text-center">
                ยังไม่มีข้อมูลยอดขายในช่วงเวลานี้
              </p>
              <div v-else class="space-y-2">
                <div
                  v-for="(item, idx) in reportData.top_menus"
                  :key="item.menu_name"
                  class="flex items-center justify-between gap-2 py-2 border-b border-stone-100 last:border-b-0 text-sm"
                >
                  <div class="flex items-center gap-2.5 min-w-0">
                    <span class="w-6 h-6 rounded-full bg-orange-50 text-brand text-xs font-bold flex items-center justify-center shrink-0 tabular-nums">
                      {{ idx + 1 }}
                    </span>
                    <span class="font-semibold text-stone-800 truncate">{{ item.menu_name }}</span>
                  </div>
                  <div class="text-right shrink-0 tabular-nums">
                    <span class="font-bold text-stone-900">{{ item.total_qty }} จาน</span>
                    <span class="text-xs text-stone-500 ml-2">{{ formatBaht(item.total_revenue) }}</span>
                  </div>
                </div>
              </div>
            </div>

            <div class="bg-white rounded-2xl border border-stone-200 p-4 space-y-3">
              <h3 class="font-bold text-stone-900 text-base">ยอดขายรายวัน</h3>
              <p v-if="reportData.daily.length === 0" class="text-sm text-stone-400 py-6 text-center">
                ยังไม่มีข้อมูลรายวันในช่วงเวลานี้
              </p>
              <div v-else class="overflow-x-auto">
                <table class="w-full text-sm text-left">
                  <thead>
                    <tr class="text-xs text-stone-500 border-b border-stone-200">
                      <th class="py-2 font-semibold">วันที่</th>
                      <th class="py-2 font-semibold text-right">บิล</th>
                      <th class="py-2 font-semibold text-right">เงินสด</th>
                      <th class="py-2 font-semibold text-right">โอน</th>
                      <th class="py-2 font-semibold text-right">รวม</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr
                      v-for="row in reportData.daily"
                      :key="row.sale_date"
                      class="border-b border-stone-100 last:border-b-0 tabular-nums"
                    >
                      <td class="py-2.5 font-medium text-stone-800">{{ row.sale_date }}</td>
                      <td class="py-2.5 text-right text-stone-600">{{ row.order_count }}</td>
                      <td class="py-2.5 text-right text-emerald-700">{{ formatBaht(row.cash_sales) }}</td>
                      <td class="py-2.5 text-right text-sky-700">{{ formatBaht(row.transfer_sales) }}</td>
                      <td class="py-2.5 text-right font-bold text-stone-900">{{ formatBaht(row.total_sales) }}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </template>
      </section>
    </div>

    <div
      v-if="menuModalOpen"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-end md:items-center justify-center md:p-4 no-print"
      @click.self="menuModalOpen = false"
    >
      <div class="bg-white w-full max-w-lg max-h-[90dvh] rounded-t-3xl md:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between shrink-0">
          <h3 class="font-bold text-stone-900 text-base">
            {{ editingMenu ? 'แก้ไขเมนู' : 'เพิ่มเมนูใหม่' }}
          </h3>
          <button
            type="button"
            class="min-h-10 min-w-10 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="menuModalOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <form class="flex-1 overflow-y-auto p-5 space-y-4" @submit.prevent="saveMenu">
          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1">ชื่อเมนู</label>
            <input
              v-model="menuForm.name"
              type="text"
              required
              maxlength="100"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">หมวดหมู่</label>
              <select
                v-model.number="menuForm.category_id"
                class="w-full min-h-11 px-3 rounded-xl border border-stone-300 text-sm bg-white"
              >
                <option v-for="cat in categories" :key="cat.id" :value="cat.id">
                  {{ cat.name }}
                </option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">ราคาเริ่มต้น (บาท)</label>
              <input
                v-model="menuForm.base_price"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                required
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 items-center">
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">ลำดับแสดงผล</label>
              <input
                v-model.number="menuForm.sort_order"
                type="number"
                min="0"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
            <label class="flex items-center gap-2.5 pt-5 cursor-pointer select-none">
              <input v-model="menuForm.is_available" type="checkbox" class="w-5 h-5 accent-brand" />
              <span class="text-sm font-semibold text-stone-800">พร้อมขาย</span>
            </label>
          </div>

          <div class="space-y-2">
            <label class="block text-sm font-semibold text-stone-700">
              กลุ่มตัวเลือกที่ผูกกับเมนูนี้ (เรียงลำดับแสดงผล)
            </label>

            <div v-if="menuForm.option_group_ids.length > 0" class="space-y-1.5">
              <div
                v-for="(gid, idx) in menuForm.option_group_ids"
                :key="gid"
                class="px-3 py-2 rounded-xl bg-orange-50 border border-orange-200 flex items-center justify-between gap-2"
              >
                <span class="text-sm font-semibold text-stone-900">
                  {{ idx + 1 }}. {{ optionGroupMap.get(gid)?.name || gid }}
                </span>
                <div class="flex items-center gap-1">
                  <button
                    type="button"
                    :disabled="idx === 0"
                    class="w-8 h-8 rounded-lg bg-white border border-orange-200 flex items-center justify-center disabled:opacity-40"
                    @click="moveGroupInMenuForm(idx, -1)"
                  >
                    <ArrowUp class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    :disabled="idx === menuForm.option_group_ids.length - 1"
                    class="w-8 h-8 rounded-lg bg-white border border-orange-200 flex items-center justify-center disabled:opacity-40"
                    @click="moveGroupInMenuForm(idx, 1)"
                  >
                    <ArrowDown class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    class="w-8 h-8 rounded-lg text-red-600 hover:bg-red-100 flex items-center justify-center"
                    @click="removeGroupFromMenuForm(gid)"
                  >
                    <X class="w-4 h-4" />
                  </button>
                </div>
              </div>
            </div>

            <div v-if="unselectedOptionGroups.length > 0" class="flex flex-wrap gap-1.5 pt-1">
              <button
                v-for="group in unselectedOptionGroups"
                :key="group.id"
                type="button"
                class="min-h-9 px-3 rounded-xl border border-stone-200 bg-stone-50 hover:bg-stone-100 text-xs font-semibold text-stone-700 flex items-center gap-1"
                @click="addGroupToMenuForm(group.id)"
              >
                <Plus class="w-3.5 h-3.5 text-brand" />
                <span>{{ group.name }}</span>
              </button>
            </div>
          </div>

          <div class="pt-2 pb-safe">
            <button
              type="submit"
              :disabled="busy"
              class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm"
            >
              {{ busy ? 'กำลังบันทึก...' : 'บันทึกเมนู' }}
            </button>
          </div>
        </form>
      </div>
    </div>

    <div
      v-if="groupModalOpen"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="groupModalOpen = false"
    >
      <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 class="font-bold text-stone-900">
            {{ editingGroup ? 'แก้ไขกลุ่มตัวเลือก' : 'เพิ่มกลุ่มตัวเลือก' }}
          </h3>
          <button
            type="button"
            class="min-h-10 min-w-10 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="groupModalOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <form class="p-5 space-y-4" @submit.prevent="saveGroup">
          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1">ชื่อกลุ่มตัวเลือก</label>
            <input
              v-model="groupForm.name"
              type="text"
              required
              maxlength="80"
              placeholder="เช่น เลือกเส้น, ระดับความเผ็ด"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm"
            />
          </div>

          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1">รูปแบบการเลือก</label>
            <div class="grid grid-cols-2 gap-2">
              <button
                type="button"
                class="min-h-11 rounded-xl border text-sm font-semibold"
                :class="
                  groupForm.selection_type === 'single'
                    ? 'bg-orange-50 border-brand text-brand-dark'
                    : 'bg-white border-stone-200 text-stone-700'
                "
                @click="groupForm.selection_type = 'single'"
              >
                เลือกได้ 1 อย่าง
              </button>
              <button
                type="button"
                class="min-h-11 rounded-xl border text-sm font-semibold"
                :class="
                  groupForm.selection_type === 'multiple'
                    ? 'bg-orange-50 border-brand text-brand-dark'
                    : 'bg-white border-stone-200 text-stone-700'
                "
                @click="groupForm.selection_type = 'multiple'"
              >
                เลือกได้หลายอย่าง
              </button>
            </div>
          </div>

          <div class="grid grid-cols-2 gap-3 items-center">
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">ลำดับ</label>
              <input
                v-model.number="groupForm.sort_order"
                type="number"
                min="0"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
            <label class="flex items-center gap-2.5 pt-5 cursor-pointer select-none">
              <input v-model="groupForm.is_required" type="checkbox" class="w-5 h-5 accent-brand" />
              <span class="text-sm font-semibold text-stone-800">บังคับเลือก</span>
            </label>
          </div>

          <button
            type="submit"
            :disabled="busy"
            class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm"
          >
            {{ busy ? 'กำลังบันทึก...' : 'บันทึกกลุ่มตัวเลือก' }}
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="optionModalOpen"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="optionModalOpen = false"
    >
      <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 class="font-bold text-stone-900">
            {{ editingOption ? 'แก้ไขตัวเลือกย่อย' : 'เพิ่มตัวเลือกย่อย' }}
          </h3>
          <button
            type="button"
            class="min-h-10 min-w-10 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="optionModalOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>

        <form class="p-5 space-y-4" @submit.prevent="saveOption">
          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1">ชื่อตัวเลือก</label>
            <input
              v-model="optionForm.name"
              type="text"
              required
              maxlength="80"
              placeholder="เช่น เส้นเล็ก, ไข่ดาว, ไม่ใส่ผัก"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm"
            />
          </div>

          <div class="grid grid-cols-2 gap-3">
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">บวกเพิ่ม (บาท)</label>
              <input
                v-model="optionForm.price_delta"
                type="number"
                inputmode="decimal"
                min="0"
                step="any"
                required
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">ลำดับ</label>
              <input
                v-model.number="optionForm.sort_order"
                type="number"
                min="0"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
          </div>

          <label class="flex items-center gap-2.5 cursor-pointer select-none">
            <input v-model="optionForm.is_available" type="checkbox" class="w-5 h-5 accent-brand" />
            <span class="text-sm font-semibold text-stone-800">พร้อมใช้งาน (ยังไม่หมด)</span>
          </label>

          <button
            type="submit"
            :disabled="busy"
            class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm"
          >
            {{ busy ? 'กำลังบันทึก...' : 'บันทึกตัวเลือก' }}
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="categoryModalOpen"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="categoryModalOpen = false"
    >
      <div class="bg-white w-full max-w-sm rounded-2xl shadow-2xl overflow-hidden">
        <div class="px-5 py-4 border-b border-stone-200 flex items-center justify-between">
          <h3 class="font-bold text-stone-900">
            {{ editingCategory ? 'แก้ไขหมวดหมู่' : 'เพิ่มหมวดหมู่' }}
          </h3>
          <button
            type="button"
            class="min-h-10 min-w-10 rounded-xl text-stone-500 hover:bg-stone-100 flex items-center justify-center"
            @click="categoryModalOpen = false"
          >
            <X class="w-5 h-5" />
          </button>
        </div>
        <form class="p-5 space-y-4" @submit.prevent="saveCategory">
          <div>
            <label class="block text-sm font-semibold text-stone-700 mb-1">ชื่อหมวดหมู่</label>
            <input
              v-model="categoryForm.name"
              type="text"
              required
              maxlength="80"
              class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm"
            />
          </div>
          <div class="grid grid-cols-2 gap-3 items-center">
            <div>
              <label class="block text-sm font-semibold text-stone-700 mb-1">ลำดับ</label>
              <input
                v-model.number="categoryForm.sort_order"
                type="number"
                min="0"
                class="w-full min-h-11 px-3.5 rounded-xl border border-stone-300 text-sm tabular-nums"
              />
            </div>
            <label class="flex items-center gap-2.5 pt-5 cursor-pointer select-none">
              <input v-model="categoryForm.is_active" type="checkbox" class="w-5 h-5 accent-brand" />
              <span class="text-sm font-semibold text-stone-800">แสดงใน POS</span>
            </label>
          </div>
          <button
            type="submit"
            :disabled="busy"
            class="w-full min-h-12 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm"
          >
            บันทึกหมวดหมู่
          </button>
        </form>
      </div>
    </div>

    <div
      v-if="confirmDialog"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="confirmDialog = null"
    >
      <div class="bg-white w-full max-w-sm rounded-2xl shadow-2xl p-5 space-y-4">
        <div class="space-y-1.5">
          <h3 class="font-bold text-stone-900 text-base">{{ confirmDialog.title }}</h3>
          <p v-if="confirmDialog.description" class="text-xs text-stone-600 leading-relaxed">
            {{ confirmDialog.description }}
          </p>
        </div>
        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            class="min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-bold text-sm"
            @click="confirmDialog = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="busy"
            class="min-h-11 rounded-xl bg-red-600 hover:bg-red-700 text-white font-bold text-sm"
            @click="executeConfirmDelete"
          >
            ยืนยันลบ
          </button>
        </div>
      </div>
    </div>

    <div
      v-if="pendingRestore"
      class="fixed inset-0 z-50 bg-stone-900/50 flex items-center justify-center p-4 no-print"
      @click.self="if (!restoringBackup) pendingRestore = null;"
    >
      <div class="bg-white w-full max-w-md rounded-2xl shadow-2xl p-5 space-y-4">
        <div class="space-y-1">
          <h3 class="font-bold text-stone-900 text-base">ยืนยันการกู้คืนข้อมูลทั้งหมด?</h3>
          <p class="text-xs text-stone-500 break-all">
            ไฟล์: {{ pendingRestore.filename }}
          </p>
        </div>

        <div class="rounded-xl bg-stone-50 border border-stone-200 p-3 space-y-1.5 text-xs text-stone-700">
          <div class="flex items-center justify-between">
            <span>สำรองข้อมูลเมื่อ</span>
            <span class="font-semibold text-stone-900 tabular-nums">{{ pendingRestore.summary.exported_at }}</span>
          </div>
          <div class="flex items-center justify-between">
            <span>หมวดหมู่ / เมนูอาหาร</span>
            <span class="font-semibold text-stone-900 tabular-nums">
              {{ pendingRestore.summary.categories }} หมวดหมู่ • {{ pendingRestore.summary.menus }} เมนู
            </span>
          </div>
          <div class="flex items-center justify-between">
            <span>กลุ่มตัวเลือก</span>
            <span class="font-semibold text-stone-900 tabular-nums">{{ pendingRestore.summary.option_groups }} กลุ่ม</span>
          </div>
          <div class="flex items-center justify-between">
            <span>บิลและคิวทั้งหมด</span>
            <span class="font-semibold text-stone-900 tabular-nums">{{ pendingRestore.summary.orders }} บิล</span>
          </div>
          <div class="flex items-center justify-between">
            <span>รูป QR ชำระเงินของร้าน</span>
            <span class="font-semibold text-stone-900">
              {{ pendingRestore.summary.has_qr_image ? 'รวมอยู่ในไฟล์' : 'ไม่มีรูปในไฟล์' }}
            </span>
          </div>
        </div>

        <p class="rounded-xl bg-amber-50 border border-amber-200 px-3 py-2 text-xs text-amber-900 leading-relaxed">
          ข้อมูลปัจจุบันทั้งหมดในระบบจะถูกแทนที่ด้วยข้อมูลจากไฟล์สำรองนี้ทันทีและไม่สามารถย้อนกลับได้
        </p>

        <div class="grid grid-cols-2 gap-2.5">
          <button
            type="button"
            :disabled="restoringBackup"
            class="min-h-11 rounded-xl border border-stone-300 bg-white hover:bg-stone-50 text-stone-700 font-bold text-sm disabled:opacity-50"
            @click="pendingRestore = null"
          >
            ยกเลิก
          </button>
          <button
            type="button"
            :disabled="restoringBackup"
            class="min-h-11 rounded-xl bg-brand hover:bg-brand-dark text-white font-bold text-sm disabled:opacity-50"
            @click="confirmRestoreBackup"
          >
            {{ restoringBackup ? 'กำลังกู้คืน...' : 'ยืนยันกู้คืนข้อมูล' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>
