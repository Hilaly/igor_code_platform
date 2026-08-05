/**
 * Вью проектов. Живёт в ядре, как и вью плагинов (docs/architecture.md): проект — сущность первого
 * класса, и создать его должно быть можно на пустой платформе, без единого плагина.
 *
 * Своих запросов здесь нет: всё приходит пропами, а действия уходят наверх. Так вью проверяется без
 * сети — той же дисциплины держится вью плагинов.
 */

import type { FilesystemEntry, Project, ProjectDraft, ProjectUpdate } from "@sovereign/protocol";
import {
  Badge,
  Button,
  Code,
  ConfirmDialog,
  Disclosure,
  EmptyState,
  Field,
  FilePicker,
  Form,
  Heading,
  Input,
  ListRow,
  Menu,
  MoreIcon,
  Notice,
  Panel,
  Spinner,
  Text,
  Tooltip,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useId, useState } from "react";

import { fetchFilesystemListing } from "./api.ts";
import { shortenPath } from "./path-shorten.ts";
import type { ProjectsState } from "./state.ts";

export type ProjectsViewProps = {
  state: ProjectsState;
  onCreate: (draft: ProjectDraft) => Promise<boolean>;
  onUpdate: (id: string, update: ProjectUpdate) => void;
  onRemove: (id: string) => void;
  onDismissComplaints: () => void;
  onOpen?: (id: string) => void;
  translator: ScopedTranslator;
};

export function ProjectsView(props: ProjectsViewProps) {
  const { state, translator } = props;
  const { t } = translator;
  const snapshot = state.snapshot;
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);

  if (snapshot === undefined) {
    return (
      <div className="projects">
        <Heading level={1}>{t("page.projects.title")}</Heading>
        {state.failure === undefined ? (
          <Spinner label={t("state.loading")} />
        ) : (
          <Notice tone="danger" title={t("projects.failed", { reason: state.failure })} />
        )}
      </div>
    );
  }

  return (
    <div className="projects">
      <Heading level={1}>{t("page.projects.title")}</Heading>

      {state.stale ? (
        <Notice tone="warning" title={t("projects.stale.title")}>
          {t("projects.stale.hint")}
        </Notice>
      ) : undefined}

      {state.failure === undefined ? undefined : (
        <Notice tone="danger" title={t("projects.write.failed", { reason: state.failure })} />
      )}

      <div className="projects-toolbar" role="toolbar" aria-label={t("page.projects.title")}>
        <Input
          value={query}
          onChange={setQuery}
          type="search"
          aria-label={t("projects.search")}
          placeholder={t("projects.search")}
        />
        <Button
          tone="accent"
          onClick={() => setCreating((open) => !open)}
          aria-expanded={creating || state.conflict !== undefined}
        >
          + {t("projects.new.title")}
        </Button>
      </div>

      {creating || state.conflict !== undefined ? (
        <NewProject
          onCreate={async (draft) => {
            const created = await props.onCreate(draft);

            if (created) {
              setCreating(false);
            }

            return created;
          }}
          onDismissComplaints={props.onDismissComplaints}
          conflict={state.conflict}
          translator={translator}
        />
      ) : undefined}

      {snapshot.projects.length === 0 ? (
        <EmptyState title={t("projects.empty")} hint={t("projects.empty.hint")} />
      ) : filterProjects(snapshot.projects, query).length === 0 ? (
        <EmptyState title={t("projects.search.empty")} hint={t("projects.search.empty.hint")} />
      ) : (
        <ul className="projects-list" aria-label={t("page.projects.title")}>
          {filterProjects(snapshot.projects, query).map((project) => (
            <ProjectRow
              key={project.id}
              project={project}
              conflicting={state.conflict?.project.id === project.id}
              onUpdate={props.onUpdate}
              onRemove={props.onRemove}
              onOpen={props.onOpen === undefined ? undefined : () => props.onOpen?.(project.id)}
              translator={translator}
            />
          ))}
        </ul>
      )}

      {snapshot.archived.length === 0 ? undefined : (
        <Disclosure summary={t("projects.archived", { count: snapshot.archived.length })}>
          <ul
            className="projects-list"
            aria-label={t("projects.archived", { count: snapshot.archived.length })}
          >
            {filterProjects(snapshot.archived, query).map((project) => (
              <ProjectRow
                key={project.id}
                project={project}
                conflicting={state.conflict?.project.id === project.id}
                onUpdate={props.onUpdate}
                onRemove={props.onRemove}
                onOpen={props.onOpen === undefined ? undefined : () => props.onOpen?.(project.id)}
                translator={translator}
              />
            ))}
          </ul>
        </Disclosure>
      )}
    </div>
  );
}

type NewProjectProps = {
  onCreate: (draft: ProjectDraft) => Promise<boolean>;
  onDismissComplaints: () => void;
  conflict: ProjectsState["conflict"];
  translator: ScopedTranslator;
};

function NewProject({ onCreate, onDismissComplaints, conflict, translator }: NewProjectProps) {
  const { t } = translator;
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // Пикер выбора папки. `cwd` — открытый каталог, `entries`/`pickerError` — его листинг, `value` —
  // выделенная строка. Всё приезжает с демона; пикер только рисует и сообщает клики.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [cwd, setCwd] = useState("/");
  const [value, setValue] = useState("");
  const [entries, setEntries] = useState<FilesystemEntry[]>([]);
  const [pickerError, setPickerError] = useState<string | undefined>(undefined);
  const ready = folder.trim() !== "" && name.trim() !== "";

  const navigatePicker = (directory: string): void => {
    setCwd(directory);
    setValue("");
    setEntries([]);
    setPickerError(undefined);
  };

  const submit = (): void => {
    if (!ready || busy) {
      return;
    }

    setBusy(true);
    void onCreate({ folder: folder.trim(), name: name.trim() }).then((created) => {
      setBusy(false);

      // Поля очищаются только после успеха: после отказа человек правит введённое, а не набирает
      // путь заново.
      if (created) {
        setFolder("");
        setName("");
      }
    });
  };

  // Листинг читается при каждом переходе и при первом открытии. Отмена — через AbortController, чтобы
  // быстрая навигация по папкам не складывала ответы в чужие каталоги.
  useEffect(() => {
    if (!pickerOpen) {
      return;
    }

    const controller = new AbortController();

    setPickerError(undefined);
    void fetchFilesystemListing(cwd, controller.signal)
      .then((listing) => setEntries(listing.entries))
      .catch((cause: unknown) => {
        if (controller.signal.aborted) {
          return;
        }

        setEntries([]);
        setPickerError(cause instanceof Error ? cause.message : String(cause));
      });

    return () => controller.abort();
  }, [pickerOpen, cwd]);

  return (
    <Panel title={t("projects.new.title")}>
      {/* Форма перехватывает Enter в любом поле и сабмитит создание; ручные `onKeyDown` на полях
          больше не нужны. Кнопка «Обзор» не сабмитит: у кит-`Button` тип `button`, не `submit`. */}
      <Form onSubmit={submit} disabled={busy || !ready}>
        <div className="projects-new">
          <Text tone="muted">{t("projects.new.hint")}</Text>

          {conflict === undefined ? undefined : (
            <Notice tone="warning" title={t("projects.conflict.title")}>
              {t("projects.conflict.hint", { name: conflict.project.name })}
            </Notice>
          )}

          <Field label={t("projects.field.folder")} hint={t("projects.field.folder.hint")}>
            {(control) => (
              <Input
                {...control}
                value={folder}
                onChange={(value) => {
                  onDismissComplaints();
                  setFolder(value);
                }}
                disabled={busy}
              />
            )}
          </Field>

          <Button
            onClick={() => {
              navigatePicker("/");
              setPickerOpen(true);
            }}
            disabled={busy}
          >
            {t("projects.field.folder.browse")}
          </Button>

          <Field label={t("projects.field.name")}>
            {(control) => <Input {...control} value={name} onChange={setName} disabled={busy} />}
          </Field>

          <Button type="submit" tone="accent" disabled={!ready} busy={busy}>
            {t("projects.new.submit")}
          </Button>
        </div>
      </Form>

      <FilePicker
        open={pickerOpen}
        cwd={cwd}
        value={value}
        entries={entries.filter((entry) => entry.kind === "directory")}
        error={pickerError}
        onNavigate={navigatePicker}
        onValueChange={setValue}
        onSelect={(path) => {
          // Выбранный путь — в то же поле, что и ручной ввод; `normalizeProjectPath` раскроет `~` и
          // симлинки уже при создании.
          onDismissComplaints();
          setFolder(path);
          setValue("");
          setPickerOpen(false);
        }}
        onClose={() => setPickerOpen(false)}
        title={t("projects.folder.picker.title")}
        upLabel={t("projects.folder.picker.up")}
        emptyLabel={t("projects.folder.picker.empty")}
        confirmLabel={t("projects.folder.picker.confirm")}
        cancelLabel={t("projects.folder.picker.cancel")}
      />
    </Panel>
  );
}

type ProjectRowProps = {
  project: Project;
  /** Этот проект занял папку, которую только что попросили. Подсветить надо именно его строку. */
  conflicting: boolean;
  onUpdate: (id: string, update: ProjectUpdate) => void;
  onRemove: (id: string) => void;
  onOpen?: () => void;
  translator: ScopedTranslator;
};

type OpenDialog = "rename" | "remove" | undefined;

function filterProjects(projects: Project[], query: string): Project[] {
  const needle = query.trim().toLocaleLowerCase();

  if (needle === "") {
    return projects;
  }

  return projects.filter((project) =>
    `${project.name} ${project.folder}`.toLocaleLowerCase().includes(needle),
  );
}

function ProjectRow({
  project,
  conflicting,
  onUpdate,
  onRemove,
  onOpen,
  translator,
}: ProjectRowProps) {
  const { t } = translator;
  const [dialog, setDialog] = useState<OpenDialog>(undefined);
  const [name, setName] = useState(project.name);
  const folderTooltipId = useId();

  // Эфемерный проект не переименовывается, не архивируется и не удаляется
  // (docs/sessions-and-projects.md), поэтому действий у него нет ни одного — не выключенных, а
  // отсутствующих: выключенная кнопка обещает, что когда-нибудь она сработает.
  const actions = project.ephemeral
    ? []
    : [
        {
          id: "rename",
          label: t("projects.action.rename"),
          onSelect: () => {
            setName(project.name);
            setDialog("rename");
          },
        },
        {
          id: "archive",
          label: project.archived ? t("projects.action.restore") : t("projects.action.archive"),
          onSelect: () => onUpdate(project.id, { name: project.name, archived: !project.archived }),
        },
        {
          id: "remove",
          label: t("projects.action.remove"),
          tone: "danger" as const,
          onSelect: () => setDialog("remove"),
        },
      ];

  return (
    <>
      <ListRow
        onSelect={onOpen}
        describedBy={onOpen === undefined ? undefined : folderTooltipId}
        actions={onOpen === undefined || actions.length === 0 ? undefined : <ProjectMenu />}
      >
        <div className="projects-row">
          <div className="projects-row-facts">
            <Text>{project.ephemeral ? t("projects.ephemeral") : project.name}</Text>
            {/*
              Длинный путь режется (`shortenPath`), а полный живёт в тултипе: папка бывает глубокой,
              и строка без усечения растягивала бы карточку или ломалась посимвольно. Тултип снизу,
              чтобы не перекрывать само имя проекта и пометки справа.
            */}
            <Tooltip id={folderTooltipId} content={project.folder} side="bottom">
              <Code>{shortenPath(project.folder)}</Code>
            </Tooltip>
          </div>

          <div className="projects-row-marks">
            {project.availability === "missing" ? (
              <Badge tone="warning">{t("projects.availability.missing")}</Badge>
            ) : undefined}
            {project.ephemeral ? (
              <Badge tone="neutral">{t("projects.ephemeral.mark")}</Badge>
            ) : undefined}
            {conflicting ? <Badge tone="warning">{t("projects.conflict.mark")}</Badge> : undefined}
            {onOpen === undefined && actions.length > 0 ? <ProjectMenu /> : undefined}
          </div>
        </div>
      </ListRow>

      <ConfirmDialog
        open={dialog === "rename"}
        onClose={() => setDialog(undefined)}
        title={t("projects.rename.title")}
        confirmLabel={t("projects.rename.confirm")}
        cancelLabel={t("common.cancel")}
        onConfirm={() => {
          onUpdate(project.id, { name: name.trim(), archived: project.archived });
          setDialog(undefined);
        }}
      >
        <Field label={t("projects.field.name")}>
          {(control) => <Input {...control} value={name} onChange={setName} />}
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={dialog === "remove"}
        onClose={() => setDialog(undefined)}
        title={t("projects.remove.title", { name: project.name })}
        // Подтверждение обязано называть, сколько сессий пропадёт, а не спрашивать «вы уверены»
        // (docs/sessions-and-projects.md). Считалки сессий ещё нет, и текст говорит об этом прямо,
        // а не показывает ноль как факт.
        description={
          project.sessionCount === 0
            ? t("projects.remove.sessions.none")
            : t("projects.remove.sessions", { count: project.sessionCount })
        }
        confirmLabel={t("projects.remove.confirm")}
        cancelLabel={t("common.cancel")}
        destructive
        onConfirm={() => {
          onRemove(project.id);
          setDialog(undefined);
        }}
      >
        <Text tone="muted">{t("projects.remove.folder")}</Text>
      </ConfirmDialog>
    </>
  );

  function ProjectMenu() {
    return (
      <Menu
        label={t("projects.actions", { name: project.name })}
        trigger={<MoreIcon size="sm" />}
        triggerLabel={t("projects.actions", { name: project.name })}
        compact
        items={actions}
      />
    );
  }
}
