# Task 3 — review fixes

## Status

Исправлена миграция глобальной шапки после ревью коммита `6b63b9f`.

## Что изменено

- `SettingsView` определяет embedded-режим через shell header context и передаёт `headingLevel={2}` в UI-kit `SettingsPage`; standalone Settings сохраняет `h1`.
- `SettingsPage` получил явный `headingLevel`, поэтому интегрированные Settings-маршруты больше не создают второй page-level `h1`.
- В `App` удалены fallback-и `page.projectId` и `page.pluginKey`: пока удалённые данные не загружены, title/context остаются стабильными и неопределёнными.
- `ChatView` больше не рисует локальный fallback `ViewHeader`; заголовок и действия принадлежат shell header registration.
- Обновлены UI/web тесты на demoted Settings heading, shell-owned Chat header и отсутствие guessed identifiers.

## Проверки

- `pnpm --filter @sovereign/ui-kit typecheck`
- `pnpm --filter @sovereign/web typecheck`
- `pnpm --filter @sovereign/web exec vitest run` — 46 файлов, 621 тест
- `pnpm --filter @sovereign/web build`
- Prettier check — успешно

## Concerns

Изменения требуют общего shell header provider для динамического Chat header; standalone-тесты оборачивают ChatView тестовым probe, production-композиция уже предоставляет provider через `Shell`.
