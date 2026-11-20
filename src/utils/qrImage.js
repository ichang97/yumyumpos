const ALLOWED_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);
const MAX_INPUT_BYTES = 10 * 1024 * 1024;
const MAX_SIDE_PX = 900;

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปได้'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('ไฟล์รูปไม่ถูกต้องหรือเสียหาย'));
    img.src = dataUrl;
  });
}

export async function prepareQrImageDataUrl(file) {
  if (!file || !ALLOWED_MIME_TYPES.has(file.type)) {
    throw new Error('รองรับเฉพาะไฟล์รูปภาพ PNG, JPG หรือ WebP เท่านั้น');
  }
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error('ไฟล์รูปมีขนาดใหญ่เกิน 10 MB');
  }

  const rawDataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(rawDataUrl);

  const maxDim = Math.max(img.width || 1, img.height || 1);
  const scale = Math.min(1, MAX_SIDE_PX / maxDim);
  const width = Math.max(1, Math.round((img.width || 1) * scale));
  const height = Math.max(1, Math.round((img.height || 1) * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('เบราว์เซอร์ไม่รองรับการย่อรูปภาพ');
  }

  ctx.fillStyle = '#FFFFFF';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(img, 0, 0, width, height);

  const pngUrl = canvas.toDataURL('image/png');
  if (pngUrl.length <= 320000) {
    return pngUrl;
  }

  const jpegHighUrl = canvas.toDataURL('image/jpeg', 0.9);
  if (jpegHighUrl.length <= 350000) {
    return jpegHighUrl;
  }

  const jpegMediumUrl = canvas.toDataURL('image/jpeg', 0.78);
  if (jpegMediumUrl.length <= 380000) {
    return jpegMediumUrl;
  }

  throw new Error('ไฟล์รูปมีขนาดใหญ่เกินไป กรุณาครอปเฉพาะส่วน QR แล้วลองใหม่');
}
