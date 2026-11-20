import { ref } from 'vue';

const ADMIN_KEY = 'yumyum_admin_mode';
const REQUIRED_TAPS = 5;
const TAP_WINDOW_MS = 2000;

const isAdminMode = ref(sessionStorage.getItem(ADMIN_KEY) === '1');
const tapCount = ref(0);
let resetTimer = null;

export function useAdminMode() {
  function clearTapCounter() {
    tapCount.value = 0;
    if (resetTimer) {
      clearTimeout(resetTimer);
      resetTimer = null;
    }
  }

  function registerLogoTap() {
    if (resetTimer) {
      clearTimeout(resetTimer);
    }
    tapCount.value += 1;

    if (tapCount.value >= REQUIRED_TAPS) {
      const nextState = !isAdminMode.value;
      isAdminMode.value = nextState;
      if (nextState) {
        sessionStorage.setItem(ADMIN_KEY, '1');
      } else {
        sessionStorage.removeItem(ADMIN_KEY);
      }
      clearTapCounter();
      return {
        toggled: true,
        unlocked: nextState,
        locked: !nextState,
        remaining: 0,
      };
    }

    resetTimer = setTimeout(() => {
      tapCount.value = 0;
      resetTimer = null;
    }, TAP_WINDOW_MS);

    return {
      toggled: false,
      unlocked: false,
      locked: false,
      tapCount: tapCount.value,
      remaining: REQUIRED_TAPS - tapCount.value,
    };
  }

  function exitAdminMode() {
    isAdminMode.value = false;
    sessionStorage.removeItem(ADMIN_KEY);
    clearTapCounter();
  }

  return {
    isAdminMode,
    tapCount,
    registerLogoTap,
    exitAdminMode,
  };
}
