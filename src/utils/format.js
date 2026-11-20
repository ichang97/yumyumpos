export function formatBaht(value) {
  const num = Number(value) || 0;
  const formatted = Number.isInteger(num)
    ? num.toLocaleString('th-TH')
    : num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `฿${formatted}`;
}

export function formatNumber(value) {
  const num = Number(value) || 0;
  return Number.isInteger(num)
    ? num.toLocaleString('th-TH')
    : num.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function formatQueueNo(queueNo) {
  const num = Number(queueNo);
  if (!Number.isInteger(num) || num <= 0) {
    return '-';
  }
  return `Q${String(num).padStart(3, '0')}`;
}

export function formatTime(dateTimeStr) {
  if (!dateTimeStr) {
    return '-';
  }
  const parts = dateTimeStr.split(' ');
  return parts[1] ? parts[1].slice(0, 5) : dateTimeStr;
}

export function formatDateTime(dateTimeStr) {
  if (!dateTimeStr) {
    return '-';
  }
  const [datePart, timePart] = dateTimeStr.split(' ');
  if (!datePart) {
    return dateTimeStr;
  }
  const [year, month, day] = datePart.split('-');
  const shortTime = timePart ? timePart.slice(0, 5) : '';
  return `${day}/${month}/${year} ${shortTime}`.trim();
}

export function getWaitMinutes(createdAtStr, nowMs = Date.now()) {
  if (!createdAtStr) {
    return 0;
  }
  const [datePart, timePart] = createdAtStr.split(' ');
  if (!datePart || !timePart) {
    return 0;
  }
  const createdMs = Date.parse(`${datePart}T${timePart}+07:00`);
  if (!Number.isFinite(createdMs)) {
    return 0;
  }
  return Math.max(0, Math.floor((nowMs - createdMs) / 60000));
}

export function formatWaitMinutes(createdAtStr, nowMs = Date.now()) {
  const mins = getWaitMinutes(createdAtStr, nowMs);
  if (mins < 1) {
    return 'เพิ่งเข้า';
  }
  if (mins < 60) {
    return `รอ ${mins} นาที`;
  }
  const hours = Math.floor(mins / 60);
  const rem = mins % 60;
  return `รอ ${hours} ชม. ${rem} น.`;
}

export function getBangkokDateStr(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function shiftDateStr(dateStr, days) {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}
