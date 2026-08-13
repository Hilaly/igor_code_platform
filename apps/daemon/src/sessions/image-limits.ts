/**
 * Пределы на изображения в сообщениях (docs/sessions-and-projects.md).
 *
 * Изображение лежит прямо в файле сессии, поэтому предел здесь — часть механизма, а не пожелание:
 * без него один разговор со скриншотами вырастает до размера, который перестаёт читаться. Значения
 * приходят из `config.json` и спрашиваются в момент проверки — файл перечитывается на живом демоне.
 *
 * Считаются декодированные байты, а не длина base64: тогда одно и то же число значит одно и то же
 * для файла с диска, вставки из буфера и восстановленной сессии.
 */

import { sessionImageBytes, type SessionEntry, type SessionImage } from "@sovereign/protocol";

export type ImageLimits = {
  maxImageBytes: number;
  maxImagesPerMessage: number;
  maxMessageImageBytes: number;
  maxSessionImageBytes: number;
};

/**
 * Отказ по пределу. Код приезжает вместе с причиной: «нагрузка велика» и «места в сессии больше нет»
 * — разные ответы, и вызывающему нечем их различить по одному тексту.
 */
export type ImageRefusal = { status: 413 | 409; reason: string };

/** Сумма декодированных байтов приложенных изображений. */
export function imagesBytes(images: readonly SessionImage[] | undefined): number {
  return (images ?? []).reduce((total, image) => total + sessionImageBytes(image), 0);
}

/** Сколько байт изображений уже лежит в записях сессии, включая брошенные ветки. */
export function entriesImageBytes(entries: readonly SessionEntry[]): number {
  return entries.reduce(
    (total, entry) =>
      entry.kind === "message"
        ? total +
          entry.content.reduce(
            (inside, block) =>
              block.kind === "image" ? inside + sessionImageBytes(block) : inside,
            0,
          )
        : total,
    0,
  );
}

/**
 * Что не так с изображениями одного сообщения. Причина называет объект и предел: «не влезло» без
 * этого заставляет угадывать, какую именно картинку убрать.
 */
export function refuseMessageImages(
  images: readonly SessionImage[] | undefined,
  limits: ImageLimits,
): ImageRefusal | undefined {
  const attached = images ?? [];

  if (attached.length === 0) {
    return undefined;
  }

  if (attached.length > limits.maxImagesPerMessage) {
    return {
      status: 413,
      reason: `a message takes at most ${String(limits.maxImagesPerMessage)} images, got ${String(attached.length)}`,
    };
  }

  for (const [index, image] of attached.entries()) {
    const bytes = sessionImageBytes(image);

    if (bytes > limits.maxImageBytes) {
      return {
        status: 413,
        reason: `image ${String(index + 1)} is ${String(bytes)} bytes and exceeds maxImageBytes of ${String(limits.maxImageBytes)}`,
      };
    }
  }

  const total = imagesBytes(attached);

  if (total > limits.maxMessageImageBytes) {
    return {
      status: 413,
      reason: `the images of the message are ${String(total)} bytes and exceed maxMessageImageBytes of ${String(limits.maxMessageImageBytes)}`,
    };
  }

  return undefined;
}

/**
 * Влезает ли сообщение в оставшийся бюджет сессии. Отдельно от проверки самого сообщения: там нагрузка
 * велика сама по себе (`413`), а здесь она законна, но места под неё в этой сессии больше нет —
 * это состояние сессии, то есть `409`.
 */
export function refuseSessionImageBudget(
  alreadyStored: number,
  added: number,
  limits: ImageLimits,
): ImageRefusal | undefined {
  if (added === 0 || alreadyStored + added <= limits.maxSessionImageBytes) {
    return undefined;
  }

  return {
    status: 409,
    reason: `the session already holds ${String(alreadyStored)} bytes of images and ${String(added)} more would exceed maxSessionImageBytes of ${String(limits.maxSessionImageBytes)}`,
  };
}

/**
 * Предел тела HTTP-запроса, в который обязано влезть сообщение с картинками. Base64 раздувает байты
 * на треть, а вокруг него ещё json — отсюда запас. Считается из предела сообщения, а не задаётся
 * отдельным ключом: два независимых числа разошлись бы, и человек упирался бы в предел, которого не
 * настраивал.
 */
export function bodyLimitFor(limits: ImageLimits): number {
  const base64Overhead = 4 / 3;
  const jsonOverhead = 64 * 1024;

  return Math.ceil(limits.maxMessageImageBytes * base64Overhead) + jsonOverhead;
}
