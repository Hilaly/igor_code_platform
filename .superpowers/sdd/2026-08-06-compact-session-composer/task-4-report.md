# Task 4 — финальная проверка визуального контракта

## Сделано

- Добавлен отдельный stylesheet-регресс-тест: overflow разрешён только у `textarea`, а `.sessions-composer` и `.sessions-composer-surface` не владеют overflow.
- В `docs/ui-kit.md` зафиксированы публичный `NextTurnPicker`, каскад провайдер → модель, reasoning fallback, placement вверх, именованные иконки и правило роста поля до 12 строк с textarea-only прокруткой.
- В `docs/README.md` добавлены ссылки на финальный UI-kit контракт и brief финальной проверки рядом со спецификацией и планом композера.

## Проверки

- `pnpm --filter @sovereign/ui-kit test -- src/components/rendering.test.tsx src/components/next-turn-picker.test.tsx` — PASS (193 теста, включая полный пакетный прогон Vitest).
- `pnpm --filter @sovereign/web test -- src/sessions/message-composer.test.tsx src/sessions/chat-view.test.tsx src/sessions/session-usage.test.tsx src/shell/styles.test.ts` — PASS (612 тестов, включая полный пакетный прогон Vitest).
- `pnpm --filter @sovereign/ui-kit typecheck` — PASS.
- `pnpm --filter @sovereign/web typecheck` — PASS.
- `pnpm exec prettier --check ...` — PASS.
- `git diff --check` — PASS.

## Остаточные риски

Поведенческие проверки каскада остаются в `next-turn-picker.test.tsx`, где доступны конкретные роли `ModelPickerMenu`; CSS-тест намеренно не дублирует их.
