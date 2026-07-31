/**
 * Панель дерева записей — выдвижной слой (`Dialog` в варианте `drawer`), а не третья колонка:
 * мастер-деталь вью уже занимает две и на узком экране складывается в одну (docs/ui-kit.md).
 *
 * Своих запросов здесь нет, как и в остальных частях вью: дерево строится из уже прочитанных
 * записей (`buildEntryTree`), лист приходит пропом, а действия уходят наверх.
 *
 * Форма записи в дерево одна и та же для метки: строкой ввода прямо в панели, а не вторым модальным
 * слоем поверх выдвижного — вложенные слои дерутся за фокус, и человеку в них некуда смотреть.
 */

import type { SessionEntry, SessionNavigateRequest } from "@sovereign/protocol";
import {
  Button,
  Dialog,
  EmptyState,
  Field,
  Input,
  Notice,
  Text,
  Toggle,
  Tree,
  type ScopedTranslator,
  type TreeNode,
} from "@sovereign/ui-kit";
import { useState } from "react";

import type { NavigationOutcome } from "./api.ts";
import { buildEntryTree, entryPath, type EntryTreeNode } from "./state.ts";

export type EntryTreeDrawerProps = {
  open: boolean;
  onClose: () => void;
  entries: SessionEntry[];
  /** Действующие метки, свёрнутые состоянием: панель их только показывает. */
  labels: Map<string, string>;
  /** Лист сессии: с него панель открывается и его ветку раскрывает. */
  leafId?: string;
  busy: boolean;
  archived: boolean;
  onNavigate: (request: SessionNavigateRequest) => Promise<NavigationOutcome>;
  onSetLabel: (entryId: string, label: string | null) => Promise<string | undefined>;
  /** Текст, отданный переходом к своей реплике: его подставляет в поле ввода вызывающий. */
  onEditorText: (text: string) => void;
  translator: ScopedTranslator;
};

/** Сколько текста реплики влезает в подпись узла: дерево — оглавление, а не вторая лента. */
const labelLimit = 48;

export function EntryTreeDrawer(props: EntryTreeDrawerProps) {
  const { open, onClose, entries, labels, leafId, busy, archived, translator } = props;
  const { t } = translator;
  /**
   * Раскрытие и выбор — своё состояние, но с падением на рабочую ветку: `undefined` означает «человек
   * ещё ничего не трогал», и тогда действует ветка листа. Так панель открывается на ней сама, не
   * дожидаясь эффекта, и переезжает вслед за листом, пока в неё не вмешались.
   */
  const [expanded, setExpanded] = useState<string[] | undefined>(undefined);
  const [selected, setSelected] = useState<string | undefined>(undefined);
  const [summarize, setSummarize] = useState(false);
  const [refusal, setRefusal] = useState<string | undefined>(undefined);

  const branchPath = entryPath(entries, leafId);
  const expandedIds = expanded ?? branchPath;
  const selectedId = selected ?? leafId;
  const selectedEntry = entries.find(({ id }) => id === selectedId);
  // Закрытая панель не строит дерева: `Dialog` и так не рисует ничего, а лента над ним перерисовыва-
  // ется на каждой дельте турна, и складывать записи в узлы на каждую из них незачем.
  const closed = !open;

  const close = (): void => {
    // Закрытая панель забывает и выбор, и раскрытие: открывают её, чтобы посмотреть, где сессия
    // сейчас, а не чтобы вернуться к тому, что смотрели до прошлого турна.
    setExpanded(undefined);
    setSelected(undefined);
    setSummarize(false);
    setRefusal(undefined);
    onClose();
  };

  const navigate = async (entryId: string): Promise<void> => {
    const outcome = await props.onNavigate({
      entryId,
      ...(summarize ? { summarize: true } : {}),
    });

    if (outcome.kind === "refused") {
      setRefusal(t("chat.navigate.refused", { reason: outcome.reason }));

      return;
    }

    // Ради этого переход к своей реплике и делается: рантайм ставит листом её родителя и отдаёт
    // текст, чтобы переспросить иначе. Не подставить его — значит потерять единственный смысл.
    if (outcome.navigated.editorText !== undefined) {
      props.onEditorText(outcome.navigated.editorText);
    }

    close();
  };

  const setLabel = async (entryId: string, label: string | null): Promise<void> => {
    const reason = await props.onSetLabel(entryId, label);

    setRefusal(reason === undefined ? undefined : t("chat.label.refused", { reason }));
  };

  if (closed) {
    return null;
  }

  return (
    <Dialog
      open={open}
      onClose={close}
      variant="drawer"
      title={t("chat.tree.title")}
      description={t("chat.tree.hint")}
      footer={<Button onClick={close}>{t("chat.tree.close")}</Button>}
    >
      {refusal === undefined ? undefined : <Notice tone="danger" title={refusal} />}

      {entries.length === 0 ? (
        <EmptyState title={t("chat.tree.empty.title")} hint={t("chat.tree.empty.hint")} />
      ) : (
        <Tree
          label={t("chat.tree.label")}
          nodes={treeNodes(buildEntryTree(entries), labels, leafId, translator)}
          {...(selectedId === undefined ? {} : { selectedId })}
          onSelect={(node) => setSelected(node.id)}
          expandedIds={expandedIds}
          onExpandedChange={setExpanded}
          toggleLabel={(node, isExpanded) =>
            t(isExpanded ? "chat.tree.collapse" : "chat.tree.expand", { entry: node.label })
          }
        />
      )}

      {selectedEntry === undefined ? undefined : (
        <div className="sessions-tree-entry">
          <Text>{describeEntry(selectedEntry, translator, Number.POSITIVE_INFINITY)}</Text>

          {archived ? (
            // Архивная сессия читается, но не работает: и переход, и метка отвечают `409`, и
            // включённая кнопка обещала бы невозможное (docs/sessions-and-projects.md).
            <Text tone="muted">{t("chat.tree.archived")}</Text>
          ) : (
            <>
              <Toggle
                checked={summarize}
                onChange={setSummarize}
                label={t("chat.tree.summarize")}
                hint={t("chat.tree.summarize.hint")}
              />
              <Button
                tone="accent"
                onClick={() => void navigate(selectedEntry.id)}
                disabled={busy}
                {...(busy ? { title: t("chat.busy.hint") } : {})}
              >
                {t("chat.tree.navigate")}
              </Button>
              <LabelEditor
                key={selectedEntry.id}
                {...(labels.has(selectedEntry.id)
                  ? { label: labels.get(selectedEntry.id) as string }
                  : {})}
                busy={busy}
                onSave={(next) => void setLabel(selectedEntry.id, next)}
                translator={translator}
              />
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

/**
 * Правка метки прямо в панели. Своё состояние сбрасывается сменой выбранной записи — ключом, а не
 * эффектом: черновик чужой метки в поле ввода хуже пустого поля.
 */
function LabelEditor(props: {
  label?: string;
  busy: boolean;
  onSave: (label: string | null) => void;
  translator: ScopedTranslator;
}) {
  const { label, busy, onSave, translator } = props;
  const { t } = translator;
  const [draft, setDraft] = useState(label ?? "");

  return (
    <div className="sessions-tree-label">
      <Field label={t("chat.label.field")} hint={t("chat.label.hint")}>
        {(control) => <Input {...control} value={draft} onChange={setDraft} disabled={busy} />}
      </Field>
      <Button
        onClick={() => onSave(draft.trim() === "" ? null : draft.trim())}
        disabled={busy || (draft.trim() === "" && label === undefined)}
      >
        {t("chat.label.confirm")}
      </Button>
      <Button onClick={() => onSave(null)} disabled={busy || label === undefined}>
        {t("chat.label.clear")}
      </Button>
    </div>
  );
}

/** Узлы кита из узлов записей. Рекурсия здесь, а не в правиле: подпись — дело перевода. */
function treeNodes(
  nodes: readonly EntryTreeNode[],
  labels: Map<string, string>,
  leafId: string | undefined,
  translator: ScopedTranslator,
): TreeNode[] {
  return nodes.map(({ entry, children }) => {
    const label = labels.get(entry.id);
    // Метка важнее признака листа: лист и так выделен выбором, а метку человек поставил руками.
    const badge =
      label !== undefined
        ? { text: label, tone: "accent" as const }
        : entry.id === leafId
          ? { text: translator.t("chat.tree.leaf"), tone: "success" as const }
          : undefined;

    return {
      id: entry.id,
      label: describeEntry(entry, translator, labelLimit),
      ...(badge === undefined ? {} : { badge }),
      ...(children.length === 0
        ? {}
        : { children: treeNodes(children, labels, leafId, translator) }),
    };
  });
}

/**
 * Запись одной строкой. У реплики это роль и начало текста, у служебной — названный вид: «запись
 * такая-то» ничего не говорит тому, кто ищет в дереве место, куда вернуться.
 */
function describeEntry(entry: SessionEntry, translator: ScopedTranslator, limit: number): string {
  const { t } = translator;

  switch (entry.kind) {
    case "message": {
      const text = entry.content
        .filter((block) => block.kind === "text")
        .map((block) => block.text)
        .join(" ")
        .trim();
      const calls = entry.content.filter((block) => block.kind === "tool-call");

      return t(`chat.tree.entry.${entry.role === "user" ? "user" : "agent"}`, {
        text:
          text === ""
            ? t("chat.tree.entry.calls", { count: String(calls.length) })
            : shorten(text, limit),
      });
    }

    case "tool-result":
      return t("chat.tree.entry.tool-result", { tool: entry.toolName });

    case "model-change":
      return t("chat.model.changed", { model: entry.model });

    case "thinking-level-change":
      return t("chat.thinking.changed", { level: entry.thinkingLevel });

    case "tools-change":
      return t("chat.tree.entry.tools-change", { count: String(entry.toolNames.length) });

    case "compaction":
      return t("chat.tree.entry.compaction", { tokens: String(entry.tokensBefore) });

    case "branch-summary":
      return t("chat.tree.entry.branch-summary");

    case "label":
      return entry.label === undefined
        ? t("chat.tree.entry.label.cleared")
        : t("chat.tree.entry.label", { label: entry.label });

    case "session-name":
      return entry.name === undefined
        ? t("chat.tree.entry.session-name.cleared")
        : t("chat.tree.entry.session-name", { name: entry.name });

    case "leaf":
      return t("chat.tree.entry.leaf");

    case "custom":
      return t("chat.tree.entry.custom", { type: entry.type });

    case "custom-message":
      return t("chat.tree.entry.custom-message", { text: shorten(entry.text, limit) });

    default:
      return t("chat.tree.entry.other", { type: entry.type });
  }
}

/** Многоточие ставится только там, где текст правда обрезан. */
function shorten(text: string, limit: number): string {
  return text.length <= limit ? text : `${text.slice(0, limit).trimEnd()}…`;
}
