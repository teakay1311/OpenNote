/**
 * Tiện ích xử lý ảnh trước khi chèn vào ghi chú.
 * Ảnh lớn (ảnh chụp điện thoại…) được thu nhỏ về tối đa 1600px và nén lại
 * để nội dung ghi chú không phình to trong cơ sở dữ liệu.
 */

const MAX_DIM = 1600;
/** Dưới ngưỡng này giữ nguyên file gốc (không mất chất) */
const KEEP_ORIGINAL_BYTES = 400 * 1024;

function readAsDataUrl(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(new Error("Không đọc được ảnh"));
    reader.readAsDataURL(file);
  });
}

function loadBitmap(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("Ảnh không hợp lệ"));
    };
    img.src = url;
  });
}

/**
 * Đọc file ảnh thành data URL, thu nhỏ + nén nếu ảnh lớn.
 * GIF giữ nguyên (canvas sẽ làm mất hiệu ứng động).
 */
export async function fileToInsertableDataUrl(file: File): Promise<string> {
  if (file.type === "image/gif" || file.size <= KEEP_ORIGINAL_BYTES) {
    return readAsDataUrl(file);
  }
  try {
    const img = await loadBitmap(file);
    const w = img.naturalWidth;
    const h = img.naturalHeight;
    if (w <= MAX_DIM && h <= MAX_DIM) return readAsDataUrl(file);

    const scale = MAX_DIM / Math.max(w, h);
    const tw = Math.round(w * scale);
    const th = Math.round(h * scale);
    const canvas = document.createElement("canvas");
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext("2d");
    if (!ctx) return readAsDataUrl(file);
    ctx.drawImage(img, 0, 0, tw, th);
    // PNG giữ nguyên định dạng (trong suốt), loại khác nén JPEG
    return canvas.toDataURL(
      file.type === "image/png" ? "image/png" : "image/jpeg",
      0.85
    );
  } catch {
    return readAsDataUrl(file);
  }
}
