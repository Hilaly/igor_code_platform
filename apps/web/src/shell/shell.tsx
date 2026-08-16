/**
 * Оболочка: левая панель (верх, основная часть, низ), центральная страница и правая панель с
 * вкладками. Заменить её плагин не может (docs/ui-extension-model.md) — хост владеет границами, размерами и полосой
 * вкладок, а плагин вкладывается в места внутри.
 */

import {
  Button,
  PanelLeftCloseIcon,
  PanelLeftOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  SegmentedControl,
  ViewHeader,
} from "@sovereign/ui-kit";
import { useEffect, useState, type ReactNode } from "react";

import {
  clampPanelWidth,
  maximumPanelWidth,
  panelWidthLimits,
  type ShellLayout,
} from "./layout.ts";
import {
  ShellHeaderActions,
  ShellHeaderProvider,
  useActiveShellHeader,
  type ShellHeaderDescription,
} from "./header.tsx";

export type ShellTabDescription = {
  id: string;
  label: string;
  content: ReactNode;
};

export type ShellProps = {
  layout: ShellLayout;
  onLayoutChange: (layout: ShellLayout) => void;
  labels: {
    left: string;
    right: string;
    /** Имя группы переключателей вкладок: сама полоса подписи не несёт. */
    tabs: string;
    emptyTabs: string;
    hideLeft: string;
    hideRight: string;
    showLeft: string;
    showRight: string;
    /** Имя меню, в которое уезжают все действия страницы, кроме главного. */
    moreActions: string;
  };
  navigation: ReactNode;
  /** Верхняя секция навигации: бренд и главное действие. */
  navigationHeader?: ReactNode;
  /** Низ левой панели: индикатор связи с демоном. Он виден всегда, а не по переходу на страницу. */
  status: ReactNode;
  tabs: ShellTabDescription[];
  /** Текущая страница не даёт правой панели места; сохранённый layout при этом не меняется. */
  rightUnavailable?: boolean;
  contentMode?: "page" | "contained";
  header: ShellHeaderDescription;
  /**
   * Действия шапки, принадлежащие оболочке, а не вью. Слот `actions` у описания шапки принадлежит
   * тому вью, которое его зарегистрировало, и вклады плагинов идут не в него: иначе смена страницы
   * уносила бы их вместе с описанием.
   */
  headerActions?: ReactNode;
  children: ReactNode;
};

export function Shell({
  layout,
  onLayoutChange,
  labels,
  navigation,
  navigationHeader,
  status,
  tabs,
  rightUnavailable = false,
  contentMode = "page",
  header,
  headerActions,
  children,
}: ShellProps) {
  // Открытая панель всегда что-то показывает: полоса вкладок объявляет выбранной ровно одну, и
  // состояния «панель открыта, а вкладка ни одна» у неё нет. Запомненный `openTab` при этом не
  // трогается — вклад исчезает на каждой пересборке плагина, и стирать выбор человека из-за этого
  // нельзя. Пока вклада нет, показывается первая вкладка, а вернувшийся вклад забирает своё место.
  const open = tabs.find((tab) => tab.id === layout.openTab) ?? tabs[0];
  const rightVisible = !rightUnavailable && !layout.rightHidden;
  const viewportWidth = useViewportWidth();
  const leftWidthBeforeRight = clampPanelWidth(
    layout.leftWidth,
    maximumPanelWidth(viewportWidth, rightVisible ? panelWidthLimits.minimum : undefined),
  );
  const rightMaximum = maximumPanelWidth(
    viewportWidth,
    layout.leftHidden ? undefined : leftWidthBeforeRight,
  );
  const rightWidth = clampPanelWidth(layout.rightWidth, rightMaximum);
  const leftMaximum = maximumPanelWidth(viewportWidth, rightVisible ? rightWidth : undefined);
  const leftWidth = clampPanelWidth(layout.leftWidth, leftMaximum);

  return (
    <div className="shell">
      {layout.leftHidden ? undefined : (
        <>
          <nav className="shell-left" aria-label={labels.left} style={{ width: `${leftWidth}px` }}>
            {/* Своей шапки у панели нет: переключатель стоит в жёлобе шапки маршрута, и строка ради
                одной кнопки не сдвигала бы вниз бренд и действие создания сессии. */}
            <div className="shell-left-main">
              {navigationHeader === undefined ? null : (
                <div className="shell-left-nav-header" data-testid="shell-left-header">
                  {navigationHeader}
                </div>
              )}
              <div className="shell-left-projects" data-testid="shell-left-projects">
                {navigation}
              </div>
            </div>
            <div className="shell-left-bottom" data-testid="shell-left-footer">
              {status}
            </div>
          </nav>
          <PanelResizer
            edge="left"
            width={leftWidth}
            maximum={leftMaximum}
            label={labels.left}
            onWidth={(leftWidth) => onLayoutChange({ ...layout, leftWidth })}
          />
        </>
      )}
      <main className="shell-page" data-content-mode={contentMode}>
        <ShellHeaderProvider description={header}>
          <ShellHeader
            moreActionsLabel={labels.moreActions}
            {...(headerActions === undefined ? {} : { actions: headerActions })}
            toggles={
              <>
                <PanelToggle
                  side="left"
                  hidden={layout.leftHidden}
                  hideLabel={labels.hideLeft}
                  showLabel={labels.showLeft}
                  onToggle={() => onLayoutChange({ ...layout, leftHidden: !layout.leftHidden })}
                />
                {/* Страница, которой правая панель не положена, переключателя не показывает: кнопка,
                    ничего не меняющая, хуже отсутствующей. */}
                {rightUnavailable ? undefined : (
                  <PanelToggle
                    side="right"
                    hidden={layout.rightHidden}
                    hideLabel={labels.hideRight}
                    showLabel={labels.showRight}
                    onToggle={() =>
                      onLayoutChange(
                        layout.rightHidden
                          ? { ...layout, rightHidden: false }
                          : // Скрытая панель открытой вкладки не имеет: ту же уборку делает и команда.
                            { ...layout, rightHidden: true, openTab: undefined },
                      )
                    }
                  />
                )}
              </>
            }
          />
          <div className="shell-body" data-content-mode={contentMode}>
            <div
              className="shell-content-frame"
              data-testid="shell-content-frame"
              data-content-mode={contentMode}
            >
              {children}
            </div>
          </div>
        </ShellHeaderProvider>
      </main>
      {rightVisible ? (
        <>
          <PanelResizer
            edge="right"
            width={rightWidth}
            maximum={rightMaximum}
            label={labels.right}
            onWidth={(rightWidth) => onLayoutChange({ ...layout, rightWidth })}
          />
          <aside
            className="shell-right"
            aria-label={labels.right}
            style={{ width: `${rightWidth}px` }}
          >
            {/*
              Полоса вкладок — переключатель вида из кита, а не россыпь кнопок-тумблеров: у открытой
              панели выбрана ровно одна вкладка, и утопленная дорожка с кареткой говорит это одним
              взглядом, тогда как капсулы `aria-pressed` читались как несколько независимых
              переключателей. Ценой ушёл повторный щелчок, закрывавший открытую вкладку: закрывается
              теперь вся панель — кнопкой в жёлобе шапки и командой окна.

              Полоса занимает всю строку: кнопка скрытия панели уехала в жёлоб шапки маршрута и места
              у вкладок больше не отнимает.
            */}
            {tabs.length === 0 ? undefined : (
              <div className="shell-tabs">
                <SegmentedControl
                  label={labels.tabs}
                  value={open?.id ?? ""}
                  options={tabs.map((tab) => ({ value: tab.id, label: tab.label }))}
                  onChange={(openTab) => onLayoutChange({ ...layout, openTab })}
                />
              </div>
            )}
            {open === undefined ? (
              <div className="shell-tab-empty">{labels.emptyTabs}</div>
            ) : (
              <div className="shell-tab-body">{open.content}</div>
            )}
          </aside>
        </>
      ) : undefined}
    </div>
  );
}

function ShellHeader({
  actions,
  moreActionsLabel,
  toggles,
}: {
  actions?: ReactNode;
  moreActionsLabel: string;
  /** Переключатели панелей: стоят в жёлобах полосы и в строку шапки не входят. */
  toggles: ReactNode;
}): React.JSX.Element {
  const { actions: viewActions, ...description } = useActiveShellHeader();
  // Пустая полоса действий не рисуется вовсе: узел из нуля кнопок оставил бы в шапке отступ за
  // несуществующим контролом.
  const viewRail =
    viewActions === undefined || viewActions.length === 0 ? undefined : (
      <ShellHeaderActions actions={viewActions} moreLabel={moreActionsLabel} />
    );
  // Действия оболочки идут после действий вью: полосой владеет хост, но первым слово у того, кто
  // страницу показывает.
  const composed =
    actions === undefined ? (
      viewRail
    ) : (
      <>
        {viewRail}
        {actions}
      </>
    );

  // Переключатели идут после шапки: они рисуются поверх её полосы, и порядка документа для этого
  // достаточно — лишний z-index конкурировал бы с меню на --sovereign-z-overlay.
  return (
    <div className="shell-header">
      <ViewHeader {...description} {...(composed === undefined ? {} : { actions: composed })} />
      {toggles}
    </div>
  );
}

/** Значок переключателя: у открытой панели стрелка смотрит наружу, у скрытой — к панели. */
const panelToggleIcons = {
  left: { shown: PanelLeftCloseIcon, hidden: PanelLeftOpenIcon },
  right: { shown: PanelRightCloseIcon, hidden: PanelRightOpenIcon },
} as const;

type PanelToggleProps = {
  side: "left" | "right";
  hidden: boolean;
  hideLabel: string;
  showLabel: string;
  onToggle: () => void;
};

/**
 * Переключатель панели: одна кнопка на оба состояния и одно место на все страницы. Стоит в жёлобе
 * полосы шапки, за которым начинаются и заголовок маршрута, и первая строка вью, — поэтому кнопка
 * ничего не сдвигает, а при сворачивании панели остаётся на том же пикселе.
 *
 * Раньше «скрыть» жила в самой панели, а «показать» — поверх угла страницы: для одного действия это
 * были два разных места, и левая панель тратила на свою кнопку целую строку.
 */
function PanelToggle({ side, hidden, hideLabel, showLabel, onToggle }: PanelToggleProps) {
  const label = hidden ? showLabel : hideLabel;
  const Icon = panelToggleIcons[side][hidden ? "hidden" : "shown"];

  return (
    <span className={`shell-panel-toggle shell-panel-toggle-${side}`}>
      {/* Тихий регистр: капсула в углу полосы спорила бы с заголовком маршрута, ради которого полоса и
          существует. Кнопка проявляется под курсором и по фокусу. */}
      <Button tone="quiet" size="sm" iconOnly aria-label={label} title={label} onClick={onToggle}>
        <Icon size="sm" />
      </Button>
    </span>
  );
}

type PanelResizerProps = {
  /** Какой край панели тянет граница: определяет знак смещения и подпись для скринридера. */
  edge: "left" | "right";
  /** Текущая ширина панели. Пришедшая пропом, а не запомненная при нажатии — от неё же считает клавиатура. */
  width: number;
  /** Максимум текущего окна: одинаков для жеста, клавиатуры и доступного диапазона. */
  maximum: number;
  /** Имя панели: у самой границы подписи нет, а `aria-valuenow` без имени говорит только число. */
  label: string;
  onWidth: (width: number) => void;
};

/**
 * Граница панели. Работает от `pointer`-событий, а не от `mouse`: с тачпада и с планшета тянуть надо
 * так же. С клавиатуры границу двигают стрелки — иначе размер панели недоступен без мыши.
 *
 * Ширина при протаскивании считается от точки начала жеста, а не приращением между кадрами: замыкание
 * внутри `onPointerDown` живёт весь жест и не видит новых пропов, поэтому шаг от предыдущей точки
 * складывался бы поверх состояния, которое уже устарело в момент нажатия, — панель дёргалась к стартовой
 * ширине на каждом кадре и не оставалась там, куда её потянули.
 */
function PanelResizer({ edge, width, maximum, label, onWidth }: PanelResizerProps) {
  const sign = edge === "left" ? 1 : -1;

  return (
    <div
      className="shell-resizer"
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={panelWidthLimits.minimum}
      aria-valuemax={maximum}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={(event) => {
        // Выделение текста при протаскивании границы — не то, чего просили мышью.
        event.preventDefault();

        // Обе точки отсчёта берутся один раз на весь жест и с этого момента не устаревают: конечная
        // ширина каждого кадра — расстояние от начала жеста, а не сумма его собственных шагов.
        const startX = event.clientX;
        const startWidth = width;

        // Слушает окно, а не сама граница: курсор во время протаскивания уходит с неё, и события
        // после этого приходят другому элементу.
        const move = (moved: PointerEvent): void => {
          onWidth(clampPanelWidth(startWidth + (moved.clientX - startX) * sign, maximum));
        };
        const drop = (): void => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", drop);
          window.removeEventListener("pointercancel", drop);
        };

        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", drop);
        // Браузер отменяет поток pointer-событий, если пользователь сменил вкладку, открыл DevTools
        // или ОС прервала жест: без этой ветки `pointerup` не приходит, и listener-ы висят вечно,
        // вызывая onWidth на каждом последующем движении мыши по странице.
        window.addEventListener("pointercancel", drop);
      }}
      onKeyDown={(event) => {
        if (event.key === "ArrowLeft") {
          onWidth(clampPanelWidth(width - sign * 16, maximum));
        }

        if (event.key === "ArrowRight") {
          onWidth(clampPanelWidth(width + sign * 16, maximum));
        }
      }}
    />
  );
}

function useViewportWidth(): number {
  const [viewportWidth, setViewportWidth] = useState(() => window.innerWidth);

  useEffect(() => {
    const update = (): void => setViewportWidth(window.innerWidth);

    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  return viewportWidth;
}
