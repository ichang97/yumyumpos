const bangkokDateTimeFormatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function getBangkokParts(date = new Date()) {
  const parts = bangkokDateTimeFormatter.formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') {
      map[part.type] = part.value;
    }
  }
  return map;
}

export function getBangkokDate(date = new Date()) {
  const parts = getBangkokParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getBangkokNow(date = new Date()) {
  const parts = getBangkokParts(date);
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}
