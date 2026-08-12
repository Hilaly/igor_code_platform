/**
 * Чтение изображений из выбора файла, буфера обмена и перетаскивания.
 *
 * Один модуль на все три способа: композер чата и экран новой сессии кладут картинки в черновик
 * одинаково, а разные реализации разошлись бы в том, что считается поддержанным файлом.
 *
 * Размеров здесь нет намеренно. Пределы живут в `config.json`, источник истины по ним — демон
 * (docs/sessions-and-projects.md), и вторая их копия в браузере расходилась бы с ним ровно в тот
 * момент, когда человек правит настройку. Отсюда проверяется только тип: он один и тот же всегда, а
 * отказ по размеру приезжает от демона названной причиной, и черновик при этом сохраняется.
 */

import { isSessionImageMimeType, type SessionImage } from "@sovereign/protocol";

/**
 * Пачка валидна целиком или не принимается вовсе: выбрав пять файлов, человек ждёт пять картинок, а
 * молча пропавшая четвёртая обнаружилась бы только в ответе модели.
 */
export type ImageIntake =
  | { kind: "read"; images: SessionImage[] }
  | { kind: "unsupported"; fileName: string }
  | { kind: "unreadable"; fileName: string };

/** Есть ли среди перетаскиваемого хоть одно изображение поддержанного типа. */
export function carriesImages(transfer: Pick<DataTransfer, "items"> | null): boolean {
  return [...(transfer?.items ?? [])].some(
    (item) => item.kind === "file" && isSessionImageMimeType(item.type),
  );
}

/** Файлы-изображения из `DataTransfer` перетаскивания или из буфера обмена. */
export function imageFilesOf(transfer: Pick<DataTransfer, "items"> | null): File[] {
  return [...(transfer?.items ?? [])].flatMap((item) => {
    if (item.kind !== "file") {
      return [];
    }

    const file = item.getAsFile();

    return file === null ? [] : [file];
  });
}

export async function readImageFiles(files: readonly File[]): Promise<ImageIntake> {
  const images: SessionImage[] = [];

  for (const file of files) {
    if (!isSessionImageMimeType(file.type)) {
      return { kind: "unsupported", fileName: file.name };
    }

    let data: string;

    try {
      data = base64Of(await file.arrayBuffer());
    } catch {
      // Файл исчез или его не дали прочитать. Молчать нельзя: человек уверен, что приложил его.
      return { kind: "unreadable", fileName: file.name };
    }

    images.push({ mimeType: file.type, data });
  }

  return { kind: "read", images };
}

/**
 * Base64 без `data:` prefix — ровно то, что принимает протокол. Через `btoa`, а не `FileReader`:
 * `FileReader` отдаёт data URL, и его пришлось бы разбирать обратно.
 */
function base64Of(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  // Порциями: `String.fromCharCode` с сотней тысяч аргументов разом переполняет стек вызовов.
  const chunkSize = 0x8000;
  let binary = "";

  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }

  return btoa(binary);
}
