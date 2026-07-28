# Финальный fix-wave UI-kit

## Корневые причины

- `SegmentedControl` оставлял нативные кнопки радиогруппы без roving tabindex и без обработки
  стрелок/Home/End, поэтому в Tab-последовательность попадали все варианты, включая недоступные.
- `Select`, `Combobox` и `MultiSelect` строили `id` из произвольного `option.value`; пробелы и
  пунктуация давали нестабильные IDREF для `aria-activedescendant`.
- `Combobox` вызывал `preventDefault()` для Home/End до проверки состояния popup, из-за чего в
  закрытом поле ломалось обычное перемещение каретки.
- `Tree` хранил `focusedId` без нормализации после изменения `nodes`; удалённый узел мог оставить
  все видимые `treeitem` с `tabIndex=-1`.
- Четыре glass-поверхности дублировали `blur(12px) saturate(180%)` вместо общего токена.

## RED/GREEN

Добавлены реальные jsdom-тесты для roving radio focus, безопасных ID при пробелах/пунктуации,
закрытого Combobox и удаления сфокусированного узла Tree. До исправлений тесты были RED (4
сценария). После минимальных исправлений весь набор стал GREEN: 9 файлов, 80 тестов.

## Изменения

- `segmented-control.tsx`: roving `tabIndex`, пропуск disabled, Arrow/Home/End, фокус и `onChange`.
- `select.tsx`, `combobox.tsx`, `multi-select.tsx`: безопасный префикс ID и индексный суффикс,
  согласованный с `aria-activedescendant`.
- `combobox.tsx`: Home/End предотвращаются только при открытом popup.
- `tree.tsx`: fallback `focusedId` на выбранный видимый или первый видимый узел, включая
  фактический DOM-фокус.
- Четыре `*.module.css`: `var(--sovereign-backdrop-blur)`.
- `interactive-components.test.tsx`: регрессионные DOM-тесты.

## Проверки

- `pnpm --filter @sovereign/ui-kit test` — 9 файлов, 80 тестов зелёные.
- `pnpm --filter @sovereign/ui-kit typecheck` — зелёный.
- Prettier, ESLint по затронутым исходникам и `git diff --check` — зелёные.
