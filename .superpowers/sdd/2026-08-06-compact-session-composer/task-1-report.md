# Task 1 — composer action icons

## Статус

Готово. В UI-kit добавлены публичные `SendIcon`, `AppendIcon` и `StopIcon`; все три используют существующий `actionIcon` и размерную сетку `Icon`.

## Файлы

- `packages/ui-kit/src/components/icons.tsx` — добавлены Lucide `Send` и `Square`, а также экспортируемые обёртки. `AppendIcon` использует существующий символ `Plus`.
- `packages/ui-kit/src/components/rendering.test.tsx` — добавлен серверный тест декоративной разметки трёх иконок.
- `packages/ui-kit/src/index.ts` — отдельное изменение не потребовалось: файл уже реэкспортирует весь `components/icons.tsx`, поэтому новые иконки автоматически входят в публичную поверхность.

Зависимости и `pnpm-lock.yaml` не изменялись: нужные символы уже доступны из установленного `lucide-react`.

## Проверки

- `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx` (до реализации: ожидаемый FAIL; после: PASS, 13 файлов / 177 тестов).
- `pnpm --filter @sovereign/ui-kit typecheck` — PASS (`tsc -p tsconfig.json`).
- `git diff --check` — PASS.

## Самопроверка

- Обёртки принимают существующий `SymbolIconProps` (`size?: IconSize`) и не раскрывают типы Lucide наружу.
- Вложенные SVG получают `aria-hidden` через общий helper; тест проверяет отсутствие `undefined`.
- Имена и порядок экспортов согласованы с соседними action icons.

## Замечания

В брифе указан `packages/ui-kit/src/index.ts` среди изменяемых файлов, но он уже содержит `export * from "./components/icons.tsx"`; добавление строк было бы дублированием и не требовалось.
