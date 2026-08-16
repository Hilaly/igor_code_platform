# Pressure-аудит встроенных Superpowers

## Область и метод

16.08.2026 проведён повторный аудит английских тел навыков в
`plugins/superpowers/skills/`. Проверялись живые инструкции, Sovereign-карта инструментов,
исторические pressure-ресурсы и статический инвентарь плагина. Команды, использованные для
воспроизведения и проверки:

```bash
rg -n "npm test|HEAD~1|BRANCH_NAME|push|subagent-spawn|elements-of-style|~/.claude" plugins/superpowers/skills
sed -n '1,240p' plugins/superpowers/skills/{brainstorming,executing-plans,using-git-worktrees,requesting-code-review,dispatching-parallel-agents}/SKILL.md
pnpm --filter @sovereign/daemon exec node --test src/plugins/superpowers-skills.test.ts
make fmt-check
make typecheck
```

## RED: независимые результаты

Три независимых аудитора зафиксировали одинаковые actionable-проблемы (здесь приведены выводы,
а не вымышленные стенограммы):

1. Brainstorming обещал автоматическое открытие вкладки браузера и безусловно ссылался на
   необязательный `elements-of-style`.
2. Executing-plans останавливался на «повторной» ошибке без определения, что именно расследовать;
   TDD/verification предписывали несуществующий универсальный `npm test` и не описывали полный
   вывод Sovereign bash.
3. Worktree/review/dispatch guidance допускала неопределённый `BRANCH_NAME`, `HEAD~1` для
   multi-commit задач и невалидный shorthand `subagent-spawn`; writing-skills требовал push без
   явного разрешения и сохранял stale Claude-пути/идентификаторы в живых сценариях.

Исторические примеры в `writing-skills/examples/` и `systematic-debugging/CREATION-LOG.md` не
исполняются как Sovereign guidance и поэтому проверяются отдельными ресурсными исключениями.

## GREEN: изменения и проверки

- Визуальный companion теперь условен: при отсутствии host capability используется текстовый или
  терминальный fallback.
- Исправлены остановка executing-plans, repository-specific `<TEST_COMMAND>`, bounded-output и
  `job-output` правила verification.
- `BRANCH_NAME` валидируется до построения пути; code review требует записанного pre-change
  `BASE_SHA`/merge-base и запрещает `HEAD~1`; dispatch examples содержат discovered agent/model,
  description и prompt.
- Push в writing-skills разрешён только после явной авторизации пользователя. Live systematic
  fixtures используют qualified `superpowers.systematic-debugging`; stale `~/.claude` утверждения
  оставлены только в явно историческом примере.
- Статический тест `superpowers-skills.test.ts` блокирует возврат `HEAD~1`, raw spawn shorthand,
  `npm test`, stale IDs и несанкционированную push-формулировку в live resources.

После правок запущены focused test, форматирование и typecheck; фактический результат записывается
в отчёте сессии `/tmp/pressure-fix-report.md`.

## Почему исторические ресурсы исключены

`writing-skills/examples/CLAUDE_MD_TESTING.md` и creation log — upstream-материалы, сохранённые как
контекст происхождения. Их удаление уничтожило бы объяснение RED-цикла и сделало бы порт менее
аудируемым. Они явно помечены historical и не входят в live-instruction static assertions.
