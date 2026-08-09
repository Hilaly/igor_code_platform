/**
 * Полоса вкладок как место (docs/ui-extension-model.md). Кардинальность `tabs` отличается от
 * коллекции механикой отрисовки: экземпляр создаётся у всех вкладов, но **смонтирован ровно один**, а
 * остальные представлены заголовками. Отсюда и разделение на две поверхности:
 *
 * - `useHostPlaceTabs` отдаёт набор хосту, который владеет полосой и выбором открытой вкладки;
 * - `PluginPlaceTabs` рисует полосу целиком, когда место объявил плагин.
 */

import { orderPlaceContributions, resolvePlaceDeclaration } from "@sovereign/protocol";
import { Tabs } from "@sovereign/ui-kit";
import { useContext, useState, type ReactNode } from "react";

import { PlaceInstance } from "./host.tsx";
import { BrowserRuntimeContext, type PlaceProps } from "./runtime-context.tsx";

/**
 * Вкладка, готовая к размещению. Структурно совпадает с `TabDescription` кита и с описанием вкладки
 * оболочки: полоса — дело того, кто владеет местом, а SDK отдаёт ему данные, а не разметку.
 */
export type HostPlaceTab = {
  id: string;
  label: string;
  content: ReactNode;
};

/**
 * Вкладки места в порядке вкладов. Заголовок берётся из снимка, поэтому полоса нарисована **до**
 * загрузки бандла: подпись известна из объявления, а не из кода вкладки.
 *
 * Содержимое — созданный, но не смонтированный элемент. Бандл закрытой вкладки не грузится: кеш
 * модулей трогает тот, кто отрисовался, а не тот, кого положили в массив.
 */
export function useHostPlaceTabs({ id, context }: PlaceProps): HostPlaceTab[] {
  const runtime = useContext(BrowserRuntimeContext);

  if (runtime === undefined) {
    return [];
  }

  return orderPlaceContributions(id, runtime.contributions, context).flatMap((registration) => {
    // Команда содержимого не даёт, а у вкладки оно обязано быть.
    if (registration.kind !== "component" || registration.ownership !== "plugin") {
      return [];
    }

    return [
      {
        id: registration.id,
        // Заголовок необязателен у объявления: реестр не знает кардинальности места, потому что
        // место вправе ещё не существовать. Запасной вариант детерминирован и жалобы не требует.
        label: registration.title ?? registration.declaredId,
        content: (
          <PlaceInstance
            reference={{
              pluginKey: registration.pluginKey,
              contributionId: registration.id,
              exportName: registration.export,
            }}
            context={context}
            fallback={null}
          />
        ),
      },
    ];
  });
}

/**
 * Полоса вкладок места, объявленного плагином. Открытая вкладка живёт в `useState`: это «небольшое
 * состояние» по таблице уровней, живущее до размонтирования. Цена названа — полоса забывает выбор
 * при размонтировании; управляемый вариант появится вместе с плагином, которому это помешает.
 */
export function PluginPlaceTabs({ id, context }: PlaceProps): ReactNode {
  const runtime = useContext(BrowserRuntimeContext);
  const declaration =
    runtime === undefined ? undefined : resolvePlaceDeclaration(id, runtime.contributions, context);
  const tabs = useHostPlaceTabs({ id, context });
  const [chosen, setChosen] = useState<string | undefined>(undefined);

  if (declaration?.cardinality !== "tabs" || tabs.length === 0) {
    return null;
  }

  // Исчезнувший выбор не чинится записью: вклад возвращается вместе с пересобранным плагином, и
  // сброшенный выбор закрывал бы вкладку человека на каждую правку исходников.
  const open = tabs.find((tab) => tab.id === chosen) ?? tabs[0];

  return open === undefined ? null : (
    <Tabs
      tabs={tabs}
      value={open.id}
      onChange={setChosen}
      label={declaration.title ?? declaration.declaredId}
    />
  );
}
