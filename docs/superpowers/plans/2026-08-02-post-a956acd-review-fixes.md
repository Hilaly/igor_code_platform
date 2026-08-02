# Исправления по ревью после `a956acd`: план реализации

> **Для агентных исполнителей:** обязательно использовать `superpowers:test-driven-development` и
> выполнять задачи последовательно в изолированном worktree.

**Цель:** закрыть шесть подтверждённых регрессий после `a956acd`, сохранив существующую архитектуру
оболочки, маршрутизатора, UI-кита и filesystem API.

**Архитектура:** исправления остаются у владельцев поведения. Оболочка сама рисует пустую правую
панель, маршрутизатор кодирует непрозрачный идентификатор, UI-кит даёт нативную семантику кнопки,
вью проектов управляет состоянием своего пикера, а демон валидирует абсолютность локального пути.

**Стек:** TypeScript, React 19, Vitest, Testing Library, `node:test`, pnpm 11, Node 24.

## Общие ограничения

- Не добавлять зависимости и новые режимы в `FilePicker`.
- Единственное расширение публичного API UI-кита — `Button.type?: "button" | "submit"`.
- Каждый тест сначала должен упасть по причине воспроизводимой регрессии.
- Каждый тематический коммит должен проходить свои тесты и содержать обязательный трейлер соавтора.
- Полная проверка в конце: `make check` и `make build` на Node из `.nvmrc`.

---

### Задача 1: восстановление пустой правой панели

**Файлы:**

- Изменить: `apps/web/src/shell/shell.test.tsx`
- Изменить: `apps/web/src/shell/shell.tsx`

**Интерфейсы:**

- Использует: `ShellProps.labels.emptyTabs`, `ShellLayout.rightHidden`, `ShellTabDescription[]`.
- Даёт: видимый `aside` и заглушку при `rightHidden === false` и отсутствии открытой вкладки.

- [ ] Добавить DOM-тест: восстановить правую панель при `tabs={[]}`, перерендерить с полученной
      раскладкой и проверить видимую заглушку `labels.emptyTabs`.
- [ ] Запустить
      `pnpm --filter @sovereign/web test -- src/shell/shell.test.tsx` и получить падение из-за
      отсутствующей заглушки.
- [ ] Убрать `open === undefined` из условия, скрывающего всю панель; внутри `aside` рисовать
      `<div className="shell-tab-empty">{labels.emptyTabs}</div>` вместо контента вкладки.
- [ ] Повторить тематический тест и убедиться, что весь файл зелёный.
- [ ] Закоммитить как `fix(web): let the empty right panel be restored`.

### Задача 2: безопасный адрес произвольного провайдера

**Файлы:**

- Изменить: `apps/web/src/router.test.ts`
- Изменить: `apps/web/src/router.ts`

**Интерфейсы:**

- Использует: `Page` с `{ kind: "providers"; providerId?: string }`.
- Даёт: `pathOf` с `encodeURIComponent(providerId)` и `matchPage` с безопасным
  `decodeURIComponent` одного сегмента.

- [ ] Добавить тест полного круга для `providerId === "vendor/модель с пробелом"` и тест, что
      `/providers/%` разбирается как неизвестный маршрут без исключения.
- [ ] Запустить `pnpm --filter @sovereign/web test -- src/router.test.ts` и увидеть неверный путь
      или разбор идентификатора.
- [ ] Кодировать сегмент в `pathOf`; декодировать его в `matchPage` через локальную функцию, которая
      возвращает `undefined` при `URIError`, после чего вернуть `unknown`.
- [ ] Повторить тематический тест.
- [ ] Закоммитить как `fix(web): round-trip provider identifiers in routes`.

### Задача 3: нативный submit форм

**Файлы:**

- Изменить: `packages/ui-kit/src/components/rendering.test.tsx`
- Изменить: `packages/ui-kit/src/components/button.tsx`
- Изменить: `apps/web/src/login/login-view.tsx`
- Изменить: `apps/web/src/projects/projects-view.tsx`
- Изменить: `apps/web/src/providers/login-view.tsx`
- Изменить: `docs/ui-kit.md`

**Интерфейсы:**

- Даёт: `ButtonProps.type?: "button" | "submit"`, по умолчанию `"button"`.
- Использует: существующий `Form.onSubmit`; подтверждающие кнопки задают `type="submit"` и не
  вызывают тот же submit повторно через `onClick`.

- [ ] Добавить серверный тест разметки: обычный `Button` имеет `type="button"`, а
      `<Button type="submit">` — `type="submit"`.
- [ ] Запустить `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx` и
      получить ошибку TypeScript/неверную разметку из-за отсутствующего пропа.
- [ ] Добавить проп в `Button`, передать его в нативную кнопку, заменить `onClick={submit}` на
      `type="submit"` в трёх формах.
- [ ] Обновить публичный контракт `Button` в `docs/ui-kit.md`.
- [ ] Запустить тесты UI-кита, login, projects и providers view.
- [ ] Закоммитить как `fix(ui-kit): restore native form submission`.

### Задача 4: состояние пикера папки проекта

**Файлы:**

- Изменить: `apps/web/src/projects/projects-view.test.tsx`
- Изменить: `apps/web/src/projects/projects-view.tsx`

**Интерфейсы:**

- Использует: общий `FilePicker` без изменений.
- Даёт: при навигации `cwd` меняется вместе с очисткой `entries`, `value` и `pickerError`; в
  `entries` пикера передаются только элементы `kind === "directory"`.

- [ ] Добавить тест с отложенным вторым запросом: после двойного клика по каталогу прежние строки
      сразу исчезают. В том же сценарии ответ корня содержит файл, но в пикере его нет.
- [ ] Запустить `pnpm --filter @sovereign/web test -- src/projects/projects-view.test.tsx` и
      увидеть старый каталог и файл.
- [ ] Ввести локальный обработчик навигации, который синхронно очищает список, выбор и ошибку;
      фильтровать файлы перед передачей `entries`.
- [ ] Повторить тематический тест.
- [ ] Закоммитить как `fix(web): harden project folder picking`.

### Задача 5: абсолютный путь filesystem API

**Файлы:**

- Изменить: `apps/daemon/src/filesystem.test.ts`
- Изменить: `apps/daemon/src/filesystem.ts`

**Интерфейсы:**

- Использует: платформенный `node:path.isAbsolute`, чтобы проверять путь по правилам ОС демона.
- Даёт: `400 {"error":"the path query parameter must be absolute"}` для относительного пути до
  вызова `readdirSync`.

- [ ] Добавить HTTP-тест с `path=relative/directory` и ожидаемым `400`.
- [ ] Запустить `pnpm --filter @sovereign/daemon exec node --test src/filesystem.test.ts` и увидеть
      текущий `404` вместо `400`.
- [ ] Импортировать `isAbsolute` и добавить проверку после обязательности параметра.
- [ ] Повторить тематический тест.
- [ ] Закоммитить как `fix(daemon): reject relative filesystem paths`.

### Финальная проверка

- [ ] Запустить `make check` на Node 24.
- [ ] Запустить `make build` на Node 24.
- [ ] Проверить `git diff --check`, чистый `git status`, трейлеры и атомарность новых коммитов.
