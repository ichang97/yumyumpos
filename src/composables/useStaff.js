import { ref } from 'vue';

const STAFF_KEY = 'yumyum_staff_name';
const RECENT_KEY = 'yumyum_recent_staff';

function loadRecentNames() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((n) => typeof n === 'string' && n.trim()) : [];
  } catch {
    return [];
  }
}

const staffName = ref(localStorage.getItem(STAFF_KEY) || '');
const recentNames = ref(loadRecentNames());

export function useStaff() {
  function setStaffName(name) {
    const trimmed = String(name || '').trim().slice(0, 80);
    if (!trimmed) {
      return false;
    }
    staffName.value = trimmed;
    localStorage.setItem(STAFF_KEY, trimmed);

    const updatedRecent = [
      trimmed,
      ...recentNames.value.filter((item) => item !== trimmed),
    ].slice(0, 6);
    recentNames.value = updatedRecent;
    localStorage.setItem(RECENT_KEY, JSON.stringify(updatedRecent));
    return true;
  }

  return {
    staffName,
    recentNames,
    setStaffName,
  };
}
