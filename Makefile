REQUIRED_NODE_MAJOR := 24

.DEFAULT_GOAL := help
.PHONY: help install dev build check typecheck lint lint-fix fmt fmt-check test clean node-version

help: ## Показать список целей
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) \
		| awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-12s\033[0m %s\n", $$1, $$2}'

node-version:
	@major=$$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0); \
	if [ "$$major" -lt $(REQUIRED_NODE_MAJOR) ]; then \
		echo "Нужен Node >= $(REQUIRED_NODE_MAJOR), сейчас $$(node -v 2>/dev/null || echo 'не найден')."; \
		echo "Версия зафиксирована в .nvmrc — выполни: nvm use"; \
		exit 1; \
	fi

install: node-version ## Установить зависимости
	pnpm install

dev: node-version ## Поднять демон и веб-интерфейс с хот-релоадом
	pnpm --recursive --parallel run dev

build: node-version ## Собрать веб-интерфейс
	pnpm --recursive run build

check: typecheck lint fmt-check test ## Полная проверка: типы, линтер, формат, тесты

typecheck: node-version ## Проверить типы во всех пакетах
	pnpm --recursive run typecheck

lint: node-version ## Линтер
	pnpm exec eslint .

lint-fix: node-version ## Линтер с автоисправлением
	pnpm exec eslint . --fix

fmt: node-version ## Отформатировать код
	pnpm exec prettier --write .

fmt-check: node-version ## Проверить форматирование
	pnpm exec prettier --check .

test: node-version ## Прогнать тесты
	pnpm --recursive run test

clean: ## Удалить артефакты сборки и зависимости
	rm -rf node_modules apps/*/node_modules packages/*/node_modules apps/*/dist packages/*/dist
