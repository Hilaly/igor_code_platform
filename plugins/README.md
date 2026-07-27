# Встроенные плагины

Корень встроенного источника
([ADR-0036](../docs/adr/0036-built-in-plugins-live-in-a-third-root-directory.md)):
папка на плагин, манифест — поле `sovereign` в его `package.json`
([docs/plugins.md](../docs/plugins.md)). Встроенный плагин включён по умолчанию
([ADR-0019](../docs/adr/0019-built-in-plugins-are-enabled-by-default.md)) и перекрывается одноимённым
из директории данных.

Плагинов здесь пока нет: ядро научилось их запускать раньше, чем появился первый.
