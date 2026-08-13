/**
 * Изображения сообщения в ленте. Тонкая обёртка над `ImageGallery` кита: здесь только перевод
 * протокола в адреса и подписи, а рамки, сетка и просмотрщик живут в ките (docs/ui-kit.md).
 *
 * Байты приезжают тем же ответом, что и запись (docs/sessions-and-projects.md), поэтому отдельного
 * адреса у картинки нет. Data URL собирается **только здесь** — на проводе и в файле сессии лежит
 * чистый base64.
 */

import type { SessionImage } from "@sovereign/protocol";
import { ImageGallery, type ScopedTranslator } from "@sovereign/ui-kit";

export function imageSource(image: SessionImage): string {
  return `data:${image.mimeType};base64,${image.data}`;
}

export type MessageImagesProps = {
  images: SessionImage[];
  translator: ScopedTranslator;
};

export function MessageImages({ images, translator }: MessageImagesProps): React.JSX.Element {
  const { t } = translator;

  return (
    <ImageGallery
      images={images.map((image, index) => ({
        source: imageSource(image),
        alt: t("chat.image.alt", { index: String(index + 1), total: String(images.length) }),
        // Тип уже проверен протоколом, поэтому хвоста `image/` довольно для расширения файла.
        downloadName: `image-${String(index + 1)}.${image.mimeType.slice("image/".length)}`,
      }))}
      labels={{
        gallery: t("chat.images"),
        open: (index, total) =>
          t("chat.image.open", { index: String(index), total: String(total) }),
        counter: (index, total) =>
          t("chat.image.counter", { index: String(index), total: String(total) }),
        previous: t("chat.image.previous"),
        next: t("chat.image.next"),
        download: t("chat.image.download"),
      }}
    />
  );
}
