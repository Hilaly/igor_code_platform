/**
 * Проект: папка на машине плюс запись платформы о ней (docs/sessions-and-projects.md). Контракт
 * лежит здесь, а не в демоне, потому что по этим же полям интерфейс рисует список и объясняет отказ.
 *
 * Нормализации пути здесь нет намеренно: она ходит в файловую систему за симлинками, а этот пакет
 * импортируется браузером. Наружу уезжает её результат — `folder` и `folderKey`.
 */

import type { SettingsParseResult } from "./settings.ts";

export const projectsPath = "/api/projects";

/** Шаблон для таблицы маршрутов демона: `:id` — идентификатор записи, не папка. */
export const projectPathPattern = `${projectsPath}/:id`;

export function projectPath(id: string): string {
  return `${projectsPath}/${encodeURIComponent(id)}`;
}

/**
 * Доступность папки — не ошибка, а состояние проекта (docs/sessions-and-projects.md): папку могли
 * переименовать, отмонтировать или удалить, и она может вернуться сама.
 */
export type ProjectAvailability = "available" | "missing";

export type Project = {
  /**
   * Идентификатор записи. В путь маршрута едет он, а не папка: путь длинный, содержит юникод и
   * меняет написание от регистра, а идентификатор переживает и то, и другое.
   */
  id: string;
  name: string;
  /** Путь, каким его показывают человеку: развёрнутый `~`, абсолютный, без `.` и `..`. */
  folder: string;
  /**
   * Ключ сравнения, по которому держится правило «один путь — один проект». Отдаётся наружу, чтобы
   * отказ «путь занят» можно было объяснить: без него два разных на вид пути конфликтуют молча.
   */
  folderKey: string;
  archived: boolean;
  /** Свойство мира, а не записи: на диске не хранится, считается наблюдателем. */
  availability: ProjectAvailability;
  /** Сколько сессий пропадёт при безвозвратном удалении (docs/sessions-and-projects.md). */
  sessionCount: number;
  /**
   * Эфемерный проект — папка `work` внутри директории данных. Он есть всегда, не архивируется, не
   * удаляется и не переименовывается; интерфейс убирает у него действия по этому признаку, а не по
   * идентификатору — идентификатор для клиента непрозрачен.
   */
  ephemeral: boolean;
  createdAt: string;
};

/**
 * Два списка, а не один с фильтром: архивные показываются отдельно
 * (docs/sessions-and-projects.md), и клиент читает в той форме, в которой рисует. Поле `archived`
 * на записи при этом остаётся — тело записи и есть тело `PUT`.
 */
export type ProjectsSnapshot = {
  projects: Project[];
  archived: Project[];
};

/** Тело создания. Папка задаётся здесь и больше не меняется. */
export type ProjectDraft = {
  folder: string;
  name: string;
};

/** Тело изменения: переименование, архивация и восстановление — одна запись целой записи. */
export type ProjectUpdate = {
  name: string;
  archived: boolean;
};

/** Ответ безвозвратного удаления. */
export type ProjectDeleted = {
  id: string;
};

/**
 * Отказ создания: путь уже занят (docs/web-api.md). Кроме текста отдаётся сама занявшая запись —
 * спецификация требует «отклоняется с указанием на существующий», а строкой текста интерфейс не
 * подсветит нужную строку списка.
 */
export type ProjectFolderTaken = {
  error: string;
  conflict: Project;
};

const draftKeys = ["folder", "name"];
const updateKeys = ["name", "archived"];

export function parseProjectDraft(
  raw: unknown,
  label = "project",
): SettingsParseResult<ProjectDraft> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, draftKeys);
  const folder = trimmedText(fields["folder"]);

  if (folder === undefined) {
    diagnostics.push(`${label}.folder must be a non-empty path`);

    return { kind: "rejected", diagnostics };
  }

  const name = trimmedText(fields["name"]);

  if (name === undefined) {
    diagnostics.push(`${label}.name must be a non-empty name`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { folder, name }, diagnostics };
}

export function parseProjectUpdate(
  raw: unknown,
  label = "project",
): SettingsParseResult<ProjectUpdate> {
  const fields = asObject(raw);

  if (fields === undefined) {
    return { kind: "rejected", diagnostics: [`${label} must be an object`] };
  }

  const diagnostics = diagnoseUnknownKeys(label, fields, updateKeys);

  // Оба поля обязательны: запись заменяет запись целиком, и тело без `archived` разархивировало бы
  // проект человеку, который менял только имя.
  for (const required of updateKeys) {
    if (fields[required] === undefined) {
      diagnostics.push(`${label}.${required} is required: the write replaces the whole record`);

      return { kind: "rejected", diagnostics };
    }
  }

  const name = trimmedText(fields["name"]);

  if (name === undefined) {
    diagnostics.push(`${label}.name must be a non-empty name`);

    return { kind: "rejected", diagnostics };
  }

  const archived = fields["archived"];

  if (typeof archived !== "boolean") {
    diagnostics.push(`${label}.archived must be a boolean, got ${JSON.stringify(archived)}`);

    return { kind: "rejected", diagnostics };
  }

  return { kind: "parsed", value: { name, archived }, diagnostics };
}

/** Пробелы по краям — опечатка ввода, а не часть пути или имени. */
function trimmedText(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed === "" ? undefined : trimmed;
}

function asObject(raw: unknown): Record<string, unknown> | undefined {
  return typeof raw === "object" && raw !== null && !Array.isArray(raw)
    ? (raw as Record<string, unknown>)
    : undefined;
}

function diagnoseUnknownKeys(
  label: string,
  fields: Record<string, unknown>,
  known: string[],
): string[] {
  return Object.keys(fields)
    .filter((key) => !known.includes(key))
    .map((key) => `${label}: unknown key ${JSON.stringify(key)} is ignored`);
}
