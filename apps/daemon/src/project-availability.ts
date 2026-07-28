/**
 * Доступность папки проекта (docs/sessions-and-projects.md). Это не ошибка, а состояние проекта:
 * папку переименовали, отмонтировали или удалили, и она может вернуться сама.
 */

import { statSync } from "node:fs";

import type { ProjectAvailability } from "@sovereign/protocol";

/**
 * Доступно — значит запись по пути есть и это папка. Файл на месте папки считается недоступностью:
 * сессию в нём всё равно не запустить.
 */
export function probeProjectFolder(folder: string): ProjectAvailability {
  try {
    // `throwIfNoEntry` подавляет только `ENOENT`. С отмонтированного тома прилетает `EIO`, из
    // закрытой папки — `EACCES`, и оба по-прежнему бросают, поэтому `try` здесь не лишний.
    return statSync(folder, { throwIfNoEntry: false })?.isDirectory() === true
      ? "available"
      : "missing";
  } catch {
    return "missing";
  }
}
