# Task 11 — отчёт

## Итог

Добавлен настоящий end-to-end тест `apps/daemon/src/plugins/file-resources.integration.test.ts`.
Он поднимает registry, plugin supervisor с встроенным `base-agent`, standalone file-resource
service с реальным watcher, project/session services и HTTP dispatcher на временных каталогах.
Сценарий проверяет создание skill, проектного agent с `skills.include`, session turn с модельным
каталогом skill и `read`, malformed/fix, удаление/восстановление agent, project isolation и cleanup.
Ожидание watcher-изменений использует revision events и повторную запись при гонке callback; fixed
sleep для filesystem lifecycle нет.

Постоянная документация обновлена: `docs/README.md` больше не ведёт на временный feature design,
`docs/file-resources.md` уже остаётся тематической точкой входа, а `docs/runbook.md` получил
практическое filesystem/API упражнение на русском с примерами AGENT.md/SKILL.md, селекторами,
диагностикой и ограничениями UI/slash commands.

## TDD и проверки

- RED: новый файл сначала запускался и падал на отсутствующем initial built-in resolution.
- GREEN: добавлено ожидание plugin lifecycle и race-safe revision helper; focused integration test
  прошёл.
- `node --test apps/daemon/src/plugins/file-resources.integration.test.ts` — PASS (1/1).
- `pnpm exec tsc -p apps/daemon/tsconfig.json --noEmit` — PASS.
- `git diff --check` — PASS.
- thematic docs service-link audit (`rg ...`) — no output.

## Commit

`c201888 test(resources): verify project file resource lifecycle`

`main.ts` production seam не менялся: существующий signal cleanup закрывает event stream, server,
settings, plugin watcher, standalone watcher, availability watcher, sessions и plugin workers.
