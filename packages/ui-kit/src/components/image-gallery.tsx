/**
 * Сетка изображений с просмотром оригинала. Примитив кита, а не вью: рамка, скругление и поверхность
 * — визуальный слой, а он живёт здесь целиком (docs/ui-kit.md).
 *
 * Байтов и протокола компонент не знает: ему дают готовые `src` и подписи. Кто собрал `src` из
 * base64, из адреса или из `blob:`, его не касается.
 */

import { useState } from "react";

import { Button } from "./button.tsx";
import { Dialog } from "./dialog.tsx";
import { ChevronLeftIcon, ChevronRightIcon, DownloadIcon } from "./icons.tsx";
import { Text } from "./text.tsx";
import { Tooltip } from "./tooltip.tsx";
import styles from "./image-gallery.module.css";

export type GalleryImage = {
  /** Готовый адрес картинки: `data:`, `blob:` или обычный URL. */
  source: string;
  /** Подпись для скринридера. Содержимого картинки в ней быть не может — только её место в ряду. */
  alt: string;
  /** Имя файла при скачивании. Без него кнопки скачивания не будет. */
  downloadName?: string;
};

export type ImageGalleryLabels = {
  gallery: string;
  open: (index: number, total: number) => string;
  counter: (index: number, total: number) => string;
  previous: string;
  next: string;
  download: string;
};

export type ImageGalleryProps = {
  images: GalleryImage[];
  labels: ImageGalleryLabels;
};

export function ImageGallery({ images, labels }: ImageGalleryProps): React.JSX.Element {
  const [opened, setOpened] = useState<number | undefined>(undefined);
  const shown = opened === undefined ? undefined : images[opened];
  const position = (opened ?? 0) + 1;

  const move = (step: number): void => {
    setOpened((current) =>
      current === undefined ? current : (current + step + images.length) % images.length,
    );
  };

  return (
    <>
      <ul className={styles.gallery} aria-label={labels.gallery}>
        {images.map((image, index) => (
          <li key={`${String(index)}:${image.source.slice(0, 48)}`}>
            <button
              type="button"
              className={styles.thumb}
              onClick={() => setOpened(index)}
              aria-label={labels.open(index + 1, images.length)}
            >
              <img src={image.source} alt={image.alt} />
            </button>
          </li>
        ))}
      </ul>

      <Dialog
        open={shown !== undefined}
        onClose={() => setOpened(undefined)}
        title={labels.counter(position, images.length)}
        footer={
          shown === undefined ? undefined : (
            <div className={styles.actions}>
              {images.length < 2 ? undefined : (
                <>
                  <Tooltip content={labels.previous}>
                    <Button iconOnly aria-label={labels.previous} onClick={() => move(-1)}>
                      <ChevronLeftIcon />
                    </Button>
                  </Tooltip>
                  <Text tone="muted">{labels.counter(position, images.length)}</Text>
                  <Tooltip content={labels.next}>
                    <Button iconOnly aria-label={labels.next} onClick={() => move(1)}>
                      <ChevronRightIcon />
                    </Button>
                  </Tooltip>
                </>
              )}
              {shown.downloadName === undefined ? undefined : (
                // Скачивание ведёт в тот же адрес, который уже нарисован: ни файла на диске, ни
                // публичной ссылки при этом не заводится.
                <a className={styles.download} href={shown.source} download={shown.downloadName}>
                  <DownloadIcon size="sm" />
                  {labels.download}
                </a>
              )}
            </div>
          )
        }
      >
        {shown === undefined ? undefined : (
          <img className={styles.full} src={shown.source} alt={shown.alt} />
        )}
      </Dialog>
    </>
  );
}
