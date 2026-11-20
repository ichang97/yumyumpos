export function normalizePromptPayId(raw) {
  return String(raw || '').replace(/\D/g, '');
}

export function isValidPromptPayId(raw) {
  const digits = normalizePromptPayId(raw);
  return /^0\d{9}$/.test(digits) || /^\d{13}$/.test(digits) || /^\d{15}$/.test(digits);
}

export function formatPromptPayDisplay(raw) {
  const digits = normalizePromptPayId(raw);
  if (/^0\d{9}$/.test(digits)) {
    return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  if (/^\d{13}$/.test(digits)) {
    return `${digits.slice(0, 1)}-${digits.slice(1, 5)}-${digits.slice(5, 10)}-${digits.slice(10, 12)}-${digits.slice(12)}`;
  }
  return digits;
}

function tlv(tag, value) {
  const len = String(value.length).padStart(2, '0');
  return `${tag}${len}${value}`;
}

export function crc16Ccitt(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let bit = 0; bit < 8; bit += 1) {
      if (crc & 0x8000) {
        crc = ((crc << 1) ^ 0x1021) & 0xffff;
      } else {
        crc = (crc << 1) & 0xffff;
      }
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

export function buildPromptPayPayload(target, amount = null) {
  const digits = normalizePromptPayId(target);
  if (!isValidPromptPayId(digits)) {
    return '';
  }

  let targetTlv = '';
  if (digits.length === 10) {
    targetTlv = tlv('01', `0066${digits.slice(1)}`);
  } else if (digits.length === 13) {
    targetTlv = tlv('02', digits);
  } else {
    targetTlv = tlv('03', digits);
  }

  const merchantInfo = `${tlv('00', 'A000000677010111')}${targetTlv}`;
  const numericAmount = amount !== null && amount !== undefined ? Number(amount) : 0;
  const hasAmount = Number.isFinite(numericAmount) && numericAmount > 0;

  const parts = [
    tlv('00', '01'),
    tlv('01', hasAmount ? '12' : '11'),
    tlv('29', merchantInfo),
    tlv('58', 'TH'),
    tlv('53', '764'),
  ];

  if (hasAmount) {
    parts.push(tlv('54', numericAmount.toFixed(2)));
  }

  const body = `${parts.join('')}6304`;
  return `${body}${crc16Ccitt(body)}`;
}
