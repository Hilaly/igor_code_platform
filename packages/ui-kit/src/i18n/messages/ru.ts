/** Русский каталог ядра: идёт в поставке (ADR-0028), остальные языки приносит плагин. */

import { coreNamespace, type CatalogRegistration } from "../catalog.ts";

export const coreRussian: CatalogRegistration = {
  namespace: coreNamespace,
  locale: "ru",
  messages: {
    "appearance.variant": "Тема",
    "appearance.variant.light": "Светлая",
    "appearance.variant.dark": "Тёмная",
    "appearance.variant.system": "Как в системе",
    "appearance.scheme": "Цветовая схема",
    "appearance.scheme.base": "Базовая",
    "appearance.scheme.check": "Проверочная (нарочно яркая)",
    "appearance.locale": "Язык",
    "connection.connecting": "Соединяется",
    "connection.open": "На связи",
    "connection.reconnecting": "Переподключается",
    "daemon.title": "Демон",
    "daemon.uptime": "работает {duration}",
    "daemon.unreachable": "Недоступен: {reason}",
    "diagnostics.title": "Диагностика",
    "diagnostics.empty": "Сказать нечего",
    "duration.hours": "{count} ч",
    "duration.minutes": "{count} мин",
    "duration.seconds": "{count} с",
    "nav.title": "Вью",
    "nav.home": "Обзор",
    "page.home.title": "Оболочка поднялась",
    "page.home.hint": "Следующим сюда встанет вью плагинов.",
    "page.plugin.title": "Эта страница принадлежит плагину",
    "page.plugin.hint":
      "Страницы плагинов появятся вместе с браузерным кодом, который собирает демон.",
    "page.unknown.title": "Нет такой страницы",
    "page.unknown.hint": "Адрес {path} не совпадает ни с чем, что знает оболочка.",
    "panel.left": "Навигация",
    "panel.right": "Боковая панель",
    "state.loading": "Загрузка…",
    "state.empty": "Пока пусто",
    "state.failed": "Что-то пошло не так",
  },
};
