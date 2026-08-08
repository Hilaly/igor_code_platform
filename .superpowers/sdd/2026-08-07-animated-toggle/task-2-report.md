# Task 2 report: compact tooltip toggles in Settings

## Сделано

- Все восемь `Toggle` внутри `SettingsRow` в списке и детали Plugins и в форме пользовательского
  провайдера используют `labelDisplay="tooltip"`.
- `entry-tree.tsx` не менялся: его самостоятельный переключатель сохраняет видимую подпись по
  умолчанию.
- Consumer-тесты проверяют доступное имя checkbox, соответствующую tooltip-подсказку и визуально
  скрытую подпись; тест списка Plugins по-прежнему фиксирует, что переключение не открывает detail.
- `docs/ui-kit.md` описывает внешний вид и анимацию тумблера, reduced motion, режимы подписи и
  правило для `SettingsRow`.

## TDD

После добавления consumer expectations `pnpm --filter @sovereign/web test` завершился RED:
три новых ожидания tooltip не нашли подсказки, остальные 642 из 645 тестов прошли. После явной
передачи `labelDisplay="tooltip"` все проверки зелёные.

## Проверка

- `pnpm --filter @sovereign/ui-kit test` — 14 файлов, 212 тестов.
- `pnpm --filter @sovereign/web test` — 47 файлов, 645 тестов.
- `pnpm --filter @sovereign/ui-kit typecheck`.
- `pnpm --filter @sovereign/web typecheck`.
- `pnpm exec prettier --check` для всех изменённых файлов.
- `pnpm exec eslint` для изменённых TypeScript/TSX файлов.
- `git diff --check`.

## Ограничения

Нет. Сервер, маршруты и API не менялись.
