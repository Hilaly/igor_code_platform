/**
 * Сокращение длинного пути для строки настроек: папка проекта, папка плагина. Полный путь живёт в
 * тултипе, а в самой строке остаётся разборчивый хвост: имя папки и несколько родительских компонент,
 * середина сворачивается в `…`. Имя последней компоненты важно всегда показывать целиком — именно
 * оно опознаёт проект или плагин.
 *
 * Усечение делается здесь, а не внутри китового `Code`: кит остаётся общим примитивом, а строка
 * настроек знает, что папка бывает глубокой и что её хвост важнее середины.
 */

const ELLIPSIS = "…";

type ParsedPath = {
  root: string;
  separator: "/" | "\\";
  segments: string[];
};

/** Разбирает видимый путь, не меняя принятую на его платформе форму корня и разделителя. */
function parsePath(folder: string): ParsedPath {
  const separator = folder.match(/[\\/]/)?.[0] === "\\" ? "\\" : "/";
  const unc = folder.match(/^([\\/]{2})([^\\/]+)[\\/]([^\\/]+)(?:[\\/]+|$)/);
  const drive = folder.match(/^([A-Za-z]:)[\\/]+/);
  let root = "";
  let remainder = folder;

  if (unc !== null) {
    root = `${separator}${separator}${unc[2]}${separator}${unc[3]}${separator}`;
    remainder = folder.slice(unc[0].length);
  } else if (drive !== null) {
    root = `${drive[1]}${separator}`;
    remainder = folder.slice(drive[0].length);
  } else if (folder.startsWith("/") || folder.startsWith("\\")) {
    root = separator;
    remainder = folder.replace(/^[\\/]+/, "");
  }

  return {
    root,
    separator,
    segments: remainder.split(/[\\/]+/).filter((segment) => segment.length > 0),
  };
}

/**
 * Сокращённый путь. Полный путь возвращается как есть, когда он укладывается в лимит: тултип всё
 * равно даёт полный текст, но без усечения строка читается легче, и `…` не режет глаз там, где оно
 * не нужно.
 *
 * Когда путь длиннее лимита, строится от минимума к полноте, и каждая следующая ступень включается,
 * только если итог в лимит влезает: `…/last` → `…/parent/last` → `…/more/parent/last`. Хвост важнее
 * головы — имя папки проекта не жертвуется ради начала пути, поэтому все помещающиеся родители
 * подключаются раньше первой компоненты.
 * Минимум `…/last` возвращается безальтернативно, даже если он сам длиннее лимита: резать `…` имя
 * проекта пополам хуже, чем показать его целиком поверх лимита.
 *
 * @param folder абсолютный или относительный путь папки проекта.
 * @param max максимальная длина сокращённой строки; по умолчанию 40 символов.
 */
export function shortenPath(folder: string, max = 40): string {
  if (folder.length <= max) {
    return folder;
  }

  const { root, separator, segments } = parsePath(folder);

  // Многоточие сообщает об опущенных компонентах. У корня и единственной компоненты опускать
  // нечего, поэтому превышение лимита здесь честнее усечения, которое изобретало бы структуру.
  if (segments.length < 2) {
    return folder;
  }

  // Последняя компонента обязательна целиком — она опознаёт проект.
  const last = segments.at(-1) ?? "";
  const minimum = `${root}${ELLIPSIS}${separator}${last}`;

  let suffix = [last];
  let firstSuffixIndex = segments.length - 1;
  let shortened = minimum;

  // Родители добавляются справа налево: ближайший к проекту контекст ценнее далёкой головы пути.
  // Первую компоненту здесь не берём — перед ней нечего было бы скрывать многоточием.
  for (let index = segments.length - 2; index > 0; index -= 1) {
    const candidateSuffix = [segments[index] ?? "", ...suffix];
    const candidate = `${root}${ELLIPSIS}${separator}${candidateSuffix.join(separator)}`;

    if (candidate.length > max) {
      break;
    }

    suffix = candidateSuffix;
    firstSuffixIndex = index;
    shortened = candidate;
  }

  // Голова подключается последней и только когда между ней и сохранённым хвостом остаётся середина.
  if (firstSuffixIndex <= 1) {
    return shortened;
  }

  const withHead = `${root}${segments[0]}${separator}${ELLIPSIS}${separator}${suffix.join(separator)}`;
  if (withHead.length <= max) {
    return withHead;
  }

  return shortened;
}

/** Строгое серединное усечение для тесных контекстных карточек. */
export function shortenPathMiddle(folder: string, max = 40): string {
  const characters = Array.from(folder);
  if (characters.length <= max) return folder;
  if (max <= 1) return ELLIPSIS;

  const remaining = max - 1;
  const headLength = Math.ceil(remaining / 2);
  const tailLength = Math.floor(remaining / 2);

  return `${characters.slice(0, headLength).join("")}${ELLIPSIS}${characters
    .slice(-tailLength)
    .join("")}`;
}
