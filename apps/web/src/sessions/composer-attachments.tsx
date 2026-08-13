/**
 * Приложенные к черновику изображения: превью с кнопкой снятия у каждого.
 *
 * Отдельно от ленты: там показывают уже отправленное и снять его нельзя, а здесь — то, что ещё можно
 * передумать прикладывать.
 */

import type { SessionImage } from "@sovereign/protocol";
import { Button, Tooltip, type ScopedTranslator } from "@sovereign/ui-kit";

import { imageSource } from "./session-images.tsx";

export type ComposerAttachmentsProps = {
  images: SessionImage[];
  onRemove: (index: number) => void;
  disabled: boolean;
  translator: ScopedTranslator;
};

export function ComposerAttachments({
  images,
  onRemove,
  disabled,
  translator,
}: ComposerAttachmentsProps): React.JSX.Element {
  const { t } = translator;

  return (
    <ul className="sessions-composer-attachments" aria-label={t("chat.attachments")}>
      {images.map((image, index) => (
        <li key={`${String(index)}:${image.data.slice(0, 24)}`}>
          <img
            src={imageSource(image)}
            alt={t("chat.image.alt", {
              index: String(index + 1),
              total: String(images.length),
            })}
          />
          <Tooltip content={t("chat.attachment.remove")}>
            <Button
              iconOnly
              aria-label={t("chat.attachment.remove.one", { index: String(index + 1) })}
              onClick={() => onRemove(index)}
              disabled={disabled}
            >
              ✕
            </Button>
          </Tooltip>
        </li>
      ))}
    </ul>
  );
}
