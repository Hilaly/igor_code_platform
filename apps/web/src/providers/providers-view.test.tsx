// @vitest-environment jsdom

/**
 * Вью провайдеров на настоящем DOM. Проверяется то, чего не видно ни в разметке первого кадра, ни
 * глазами за один проход: что беда с кредами не прячет список, что три состояния авторизации
 * различимы (а не сведены к «есть/нет»), что модели спрашиваются по раскрытию строки, и что
 * интерактивный вход проходится целиком — все четыре вопроса, все четыре сообщения, конфликт,
 * устаревший шаг, отмена, исход и ловушка выхода из провайдера с кредом из окружения.
 *
 * Переводчик здесь бросает на любой ненайденный ключ: непереведённая строка в интерфейсе — не
 * «мелочь на потом», а то, ради чего диагностика вообще заведена (docs/ui-kit.md).
 */

import type {
  LoginAttemptState,
  LoginNotice,
  LoginPrompt,
  ModelSummary,
  ProviderSummary,
} from "@sovereign/protocol";
import { coreEnglish, coreNamespace, coreRussian, createTranslator } from "@sovereign/ui-kit";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  applyLogout,
  applyStaleAnswer,
  applyStarted,
  applyTaken,
  type LoginsState,
} from "./login-state.ts";
import { ProvidersView } from "./providers-view.tsx";
import {
  applyModels,
  applyModelsFailure,
  applySnapshot,
  initialProvidersState,
  markModelsLoading,
  type ProvidersState,
} from "./state.ts";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

afterEach(cleanup);

const translator = createTranslator({
  locale: "ru",
  namespace: coreNamespace,
  catalogs: [coreEnglish, coreRussian],
  onDiagnostic: (diagnostic) => {
    throw new Error(diagnostic);
  },
});

/** Имя отличается от идентификатора нарочно: в строке стоит и то и другое, как у настоящих. */
const named = (id: string): string => `${id[0]?.toUpperCase() ?? ""}${id.slice(1)}`;

const provider = (id: string, overrides: Partial<ProviderSummary> = {}): ProviderSummary => ({
  id,
  name: named(id),
  logins: [{ type: "api_key", label: `${id} API key` }],
  auth: { kind: "unconfigured" },
  keys: [],
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 2,
  ...overrides,
});

const model = (id: string, overrides: Partial<ModelSummary> = {}): ModelSummary => ({
  id,
  name: id,
  providerId: "anthropic",
  contextWindow: 200_000,
  maxTokens: 32_000,
  reasoning: true,
  input: ["text"],
  cost: { input: 3, output: 15 },
  ...overrides,
});

function show(state: ProvidersState, providerId?: string, headingLevel: 1 | 2 = 1) {
  const handlers = {
    onOpen: vi.fn(),
    onBack: vi.fn(),
    onLogIn: vi.fn(),
    onAnswer: vi.fn(),
    onCancelLogin: vi.fn(),
    onCloseLogin: vi.fn(),
    onLogOut: vi.fn(),
    onCreate: vi.fn(),
    onEdit: vi.fn(),
    onDelete: vi.fn(async () => undefined),
    onRefresh: vi.fn(async () => undefined),
    onRenameKey: vi.fn(async () => undefined),
    onSelectKey: vi.fn(async () => undefined),
    onRemoveKey: vi.fn(async () => undefined),
    actionFailure: undefined,
  };

  const { rerender } = render(
    <ProvidersView
      state={state}
      providerId={providerId}
      headingLevel={headingLevel}
      {...handlers}
      translator={translator}
    />,
  );

  return {
    ...handlers,
    again: (next: ProvidersState, id?: string) =>
      rerender(
        <ProvidersView
          state={next}
          providerId={id ?? providerId}
          headingLevel={headingLevel}
          {...handlers}
          translator={translator}
        />,
      ),
  };
}

const withProviders = (providers: ProviderSummary[], problem?: string): ProvidersState =>
  applySnapshot(initialProvidersState, {
    providers,
    ...(problem === undefined ? {} : { problem }),
  });

const attempt = (overrides: Partial<LoginAttemptState> = {}): LoginAttemptState => ({
  attemptId: "a1b2",
  providerId: "anthropic",
  method: "oauth",
  origin: "session",
  answerable: true,
  notices: [],
  startedAt: "2026-07-29T09:11:04.512Z",
  ...overrides,
});

/** Провайдер раскрыт и в него идёт вход: диалог показывается вместе со списком. */
const withLogin = (state: ProvidersState, logins: LoginsState): ProvidersState => ({
  ...state,
  logins,
});

const asking = (prompt: LoginPrompt, state = withProviders([provider("anthropic")])) =>
  withLogin(state, applyStarted(state.logins, attempt({ pending: prompt })));

const saying = (notice: LoginNotice, state = withProviders([provider("anthropic")])) =>
  withLogin(state, applyStarted(state.logins, attempt({ notices: [notice] })));

/** Строка провайдера: значки и подписи ищутся внутри своей строки, а не по всей странице. */
const rowOf = (name: string): HTMLElement => {
  const label = screen.getByText(name);
  const row = label.closest("li");

  if (row === null) {
    throw new Error(`the row of ${name} was not found`);
  }

  return row;
};

describe("ProvidersView", () => {
  it("waits for the first snapshot instead of showing an empty list", () => {
    show(initialProvidersState);

    expect(screen.queryByText("Провайдеров нет вовсе")).toBeNull();
    expect(screen.getByRole("status")).toBeDefined();
  });

  it("says why the providers could not be read", () => {
    show({ ...initialProvidersState, failure: "the daemon answered 500" });

    expect(screen.getByText(/the daemon answered 500/)).toBeDefined();
  });

  it("shows the trouble with the credentials and the list all the same", () => {
    // Каталог провайдеров от файла кредов не зависит (docs/web-api.md): пустое вью чинить файл не
    // помогает, а вью с честным «сказать нечем» — помогает.
    show(
      withProviders(
        [provider("anthropic", { auth: { kind: "unknown" } })],
        "credentials.json is not valid json",
      ),
    );

    expect(screen.getByText(/credentials\.json is not valid json/)).toBeDefined();
    expect(screen.getByText("Креды не читаются")).toBeDefined();
    expect(within(rowOf("Anthropic")).getByText("Сказать нечем")).toBeDefined();
  });

  it("tells the three states of the authorisation apart", () => {
    show(
      withProviders([
        provider("anthropic", { auth: { kind: "configured", type: "oauth", source: "OAuth" } }),
        provider("openai", { auth: { kind: "unconfigured" } }),
        provider("groq", { auth: { kind: "unknown" } }),
      ]),
    );

    expect(within(rowOf("Anthropic")).getByText("Подписка")).toBeDefined();
    expect(within(rowOf("Openai")).getByText("Не настроен")).toBeDefined();
    expect(within(rowOf("Groq")).getByText("Сказать нечем")).toBeDefined();
  });

  it("names where the credential came from: from the environment there is no way out", () => {
    show(
      withProviders([
        provider("anthropic", {
          auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
        }),
      ]),
    );

    expect(within(rowOf("Anthropic")).getByText(/ANTHROPIC_API_KEY/)).toBeDefined();
  });

  it("names the ways in on the row of the provider", () => {
    show(
      withProviders([
        provider("anthropic", {
          logins: [
            { type: "api_key", label: "Anthropic API key" },
            { type: "oauth", label: "Sign in with Claude Pro/Max" },
          ],
        }),
      ]),
    );

    const row = rowOf("Anthropic");

    expect(within(row).getByText(/Anthropic API key/)).toBeDefined();
    expect(within(row).getByText(/Sign in with Claude Pro\/Max/)).toBeDefined();
  });

  it("says outright that a provider with no ways in cannot be logged into", () => {
    show(withProviders([provider("bedrock", { logins: [] })]));

    expect(within(rowOf("Bedrock")).getByText(/только из окружения/)).toBeDefined();
  });

  it("counts the models without asking for them", () => {
    show(withProviders([provider("anthropic", { modelCount: 21 })]));

    expect(within(rowOf("Anthropic")).getByText("21 модель")).toBeDefined();
  });

  it("marks a list that comes from the network and a provider of a plugin", () => {
    show(
      withProviders([
        provider("ollama", { dynamic: true, custom: true }),
        provider("anthropic", {}),
      ]),
    );

    expect(within(rowOf("Ollama")).getByText("список из сети")).toBeDefined();
    expect(within(rowOf("Ollama")).getByText("от плагина")).toBeDefined();
    expect(within(rowOf("Anthropic")).queryByText("список из сети")).toBeNull();
  });

  it("opens the page of the provider the human picked", () => {
    // Вся строка, а не только имя, остаётся одной кнопкой перехода. Вложенные кнопки здесь
    // недопустимы: браузер перестраивает такую разметку, а клавиатурная навигация распадается.
    const { onOpen } = show(withProviders([provider("anthropic"), provider("openai")]));
    const list = screen.getByRole("list");
    const rows = within(list).getAllByRole("listitem");

    expect(rows).toHaveLength(2);
    expect(within(rows[0]!).getAllByRole("button")).toHaveLength(1);
    expect(within(rows[1]!).getAllByRole("button")).toHaveLength(1);

    fireEvent.click(within(rowOf("Openai")).getByRole("button"));

    expect(onOpen).toHaveBeenCalledWith("openai");
  });

  it("keeps provider detail actions outside the selectable list rows", () => {
    show(
      withProviders([provider("acme", { origin: "user", custom: true, dynamic: true })]),
      "acme",
    );

    const edit = screen.getByRole("button", { name: "Редактировать" });
    const refresh = screen.getByRole("button", { name: "Обновить модели" });
    const remove = screen.getByRole("button", { name: "Удалить" });

    expect(edit.closest("li")).toBeNull();
    expect(refresh.closest("li")).toBeNull();
    expect(remove.closest("li")).toBeNull();
  });

  it("presents provider identity and access as flat settings rows", () => {
    show(withProviders([provider("anthropic")]), "anthropic");

    expect(screen.getByRole("group", { name: "Anthropic" })).toBeDefined();
    expect(screen.getByRole("group", { name: "Вход в Anthropic" })).toBeDefined();
  });

  it("names the access and model regions independently", () => {
    show(
      applyModels(
        markModelsLoading(withProviders([provider("anthropic")]), "anthropic"),
        "anthropic",
        [model("claude-opus-4")],
      ),
      "anthropic",
    );

    expect(screen.getByRole("region", { name: "Вход в Anthropic" })).toBeDefined();
    expect(screen.getByRole("region", { name: "Модели: Anthropic" })).toBeDefined();
  });

  it("shows the models of the open provider with the window and the price", () => {
    const state = applyModels(
      markModelsLoading(withProviders([provider("anthropic")]), "anthropic"),
      "anthropic",
      [model("claude-opus-4", { name: "Opus 4" })],
    );

    show(state, "anthropic");

    expect(screen.getByText("Модели: Anthropic")).toBeDefined();
    expect(screen.getByText("Opus 4")).toBeDefined();
    expect(screen.getByText("anthropic/claude-opus-4")).toBeDefined();
    expect(screen.getByText(/Контекст: 200/)).toBeDefined();
    expect(screen.getByText(/\$3/)).toBeDefined();
  });

  it("waits for the models of the open provider and offers a way back", () => {
    const state = markModelsLoading(withProviders([provider("anthropic")]), "anthropic");

    const { onBack } = show(state, "anthropic");

    expect(screen.getByRole("status")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: /Все провайдеры/ }));
    expect(onBack).toHaveBeenCalled();
  });

  it("says why the models could not be read and offers a way back", () => {
    const state = applyModelsFailure(
      markModelsLoading(withProviders([provider("anthropic")]), "anthropic"),
      "anthropic",
      "not found",
    );

    show(state, "anthropic");

    expect(screen.getByText(/not found/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Все провайдеры/ })).toBeDefined();
  });

  it("says outright when the address names a provider nobody has", () => {
    // Идентификатор не валидируется форматом маршрута: «нет такого» говорит вью по снимку.
    show(withProviders([provider("anthropic")]), "несуществующий");

    expect(screen.getByText(/несуществующий/)).toBeDefined();
    expect(screen.getByRole("button", { name: /Все провайдеры/ })).toBeDefined();
  });

  it("keeps an unknown embedded provider page free of a nested page heading", () => {
    show(withProviders([provider("anthropic")]), "несуществующий", 2);

    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });

  it("shows no models of a provider nobody opened", () => {
    const state = applyModels(withProviders([provider("anthropic")]), "anthropic", [
      model("claude-opus-4"),
    ]);

    show(state);

    expect(screen.queryByText("anthropic/claude-opus-4")).toBeNull();
  });
});

describe("the way into a provider", () => {
  it("offers a button per way in, labelled by the provider itself", () => {
    // Подпись приходит от провайдера: «Anthropic API key», «Sign in with SuperGrok» — своей мы бы
    // назвали вход не тем именем, каким его знает человек (docs/web-api.md).
    const { onLogIn } = show(
      withProviders([
        provider("anthropic", {
          logins: [
            { type: "api_key", label: "Anthropic API key" },
            { type: "oauth", label: "Sign in with Claude Pro/Max" },
          ],
        }),
      ]),
      "anthropic",
    );

    fireEvent.click(screen.getByRole("button", { name: "Sign in with Claude Pro/Max" }));

    expect(onLogIn).toHaveBeenCalledWith("anthropic", "oauth");
    expect(screen.getByRole("button", { name: "Anthropic API key" })).toBeDefined();
  });

  it("offers no button at all when the provider declares no way in", () => {
    show(withProviders([provider("anthropic", { logins: [] })]), "anthropic");

    expect(screen.getByText("Вход в Anthropic")).toBeDefined();
    expect(screen.queryByRole("button", { name: /API key/ })).toBeNull();
  });

  it("does not offer a second login while the first is running", () => {
    // Второй вход в того же провайдера маршрут отклоняет (docs/web-api.md): кнопка, ведущая в
    // заведомый отказ, врёт про возможность.
    const state = withProviders([provider("anthropic")]);

    show(withLogin(state, applyStarted(state.logins, attempt())), "anthropic");

    expect(screen.getByRole("button", { name: "anthropic API key" })).toHaveProperty(
      "disabled",
      true,
    );
  });

  it("says the login did not start at all", () => {
    const state = withProviders([provider("anthropic")]);

    show(withLogin(state, { ...state.logins, failure: "the daemon answered 500" }), "anthropic");

    expect(screen.getByText(/Вход не начался: the daemon answered 500/)).toBeDefined();
  });
});

describe("the keys of a provider", () => {
  const configured = (keys: ProviderSummary["keys"], selectedKey?: string): ProviderSummary =>
    provider("anthropic", {
      auth: { kind: "configured", type: "api_key", source: "stored credential" },
      keys,
      ...(selectedKey === undefined ? {} : { selectedKey }),
    });

  const twoKeys = () =>
    configured(
      [
        { id: "key-1", label: "личный", type: "api_key" },
        { id: "key-2", label: "", type: "api_key" },
      ],
      "key-1",
    );

  it("shows every key with its label, identifier and way in", () => {
    show(withProviders([twoKeys()]), "anthropic");

    expect(screen.getByText("личный")).toBeDefined();
    expect(screen.getByText("key-1")).toBeDefined();
    // Ключ без подписи не остаётся безымянной строкой: адресовать его человеку было бы нечем.
    expect(screen.getByText("Без подписи")).toBeDefined();
    expect(screen.getByText("выбранный")).toBeDefined();
  });

  it("says nothing about the way in of a key whose credential was not understood", () => {
    show(withProviders([configured([{ id: "key-1", label: "правленный" }], "key-1")]), "anthropic");

    // Ключ из списка не пропадает: иначе чинить было бы нечего (docs/models-and-providers.md).
    expect(screen.getByText("кред не разобран")).toBeDefined();
  });

  it("offers no key section to a provider with no stored keys", () => {
    // Кред из окружения ключом не является, и пустой список рядом с настроенным провайдером
    // читался бы как поломка.
    show(
      withProviders([
        provider("anthropic", {
          auth: { kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" },
        }),
      ]),
      "anthropic",
    );

    expect(screen.queryByText("Ключи: Anthropic")).toBeNull();
  });

  it("makes another key the selected one", () => {
    const { onSelectKey } = show(withProviders([twoKeys()]), "anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Сделать выбранным" }));

    expect(onSelectKey).toHaveBeenCalledWith("anthropic", "key-2");
  });

  it("offers no way to select the key that is already selected", () => {
    show(withProviders([twoKeys()]), "anthropic");

    // Кнопка одна, и она у невыбранного ключа: у выбранного она ничего бы не делала.
    expect(screen.getAllByRole("button", { name: "Сделать выбранным" })).toHaveLength(1);
  });

  it("renames a key by what was typed", () => {
    const { onRenameKey } = show(withProviders([twoKeys()]), "anthropic");

    fireEvent.click(screen.getAllByRole("button", { name: "Переименовать" })[0] as HTMLElement);
    fireEvent.change(screen.getByLabelText("Подпись ключа key-1"), {
      target: { value: "рабочий" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));

    expect(onRenameKey).toHaveBeenCalledWith("anthropic", "key-1", "рабочий");
  });

  it("replaces the credential of a key by the way in it was made with", () => {
    const { onLogIn } = show(withProviders([twoKeys()]), "anthropic");

    fireEvent.click(screen.getAllByRole("button", { name: "Заменить" })[0] as HTMLElement);

    expect(onLogIn).toHaveBeenCalledWith("anthropic", "api_key", {
      kind: "existing",
      keyId: "key-1",
    });
  });

  it("offers no replacement in a way the provider does not declare", () => {
    // У ключа подписки нет шагов входа по ключу: кнопка вела бы в чужой диалог.
    show(
      withProviders([
        provider("anthropic", {
          auth: { kind: "configured", type: "oauth" },
          logins: [{ type: "api_key", label: "Anthropic API key" }],
          keys: [{ id: "key-1", label: "подписка", type: "oauth" }],
          selectedKey: "key-1",
        }),
      ]),
      "anthropic",
    );

    expect(screen.queryByRole("button", { name: "Заменить" })).toBeNull();
  });

  it("asks before removing a key and says the rest stay", () => {
    const { onRemoveKey } = show(withProviders([twoKeys()]), "anthropic");

    fireEvent.click(screen.getAllByRole("button", { name: "Убрать" })[0] as HTMLElement);

    expect(screen.getByText(/Остальные ключи провайдера останутся/)).toBeDefined();
    expect(onRemoveKey).not.toHaveBeenCalled();

    const dialog = screen.getByRole("dialog");

    fireEvent.click(within(dialog).getByRole("button", { name: "Убрать" }));

    expect(onRemoveKey).toHaveBeenCalledWith("anthropic", "key-1");
  });
});

describe("a login that is already running", () => {
  it("keeps the login flow in a flat settings row", () => {
    const state = withProviders([provider("anthropic")]);

    show(withLogin(state, applyStarted(state.logins, attempt())));

    expect(screen.getByRole("group", { name: "Вход в Anthropic" })).toBeDefined();
    expect(document.querySelector("[class*='panel']")).toBeNull();
  });

  it("shows who took the provider and that a plugin answers its questions", () => {
    const state = withProviders([provider("anthropic")]);

    show(
      withLogin(state, applyTaken(state.logins, attempt({ origin: "plugin", answerable: false }))),
    );

    expect(screen.getByText("Вход в этого провайдера уже идёт")).toBeDefined();
    expect(screen.getByText(/Его начал плагин/)).toBeDefined();
  });

  it("shows the question of a plugin login without a form to answer it with", () => {
    const state = withProviders([provider("anthropic")]);
    const running = attempt({
      origin: "plugin",
      answerable: false,
      pending: { stepId: "a1b2-1", kind: "text", message: "Имя организации" },
    });

    show(withLogin(state, applyTaken(state.logins, running)));

    expect(screen.getByText("Имя организации")).toBeDefined();
    expect(screen.queryByRole("button", { name: "Отправить ответ" })).toBeNull();
    // Отменить чужую попытку маршрут не даст (docs/web-api.md): кнопка вела бы в заведомый отказ.
    expect(screen.queryByRole("button", { name: "Отменить вход" })).toBeNull();
  });

  it("cancels the login instead of hiding it", () => {
    const state = withProviders([provider("anthropic")]);
    const { onCancelLogin, onCloseLogin } = show(
      withLogin(state, applyStarted(state.logins, attempt())),
    );

    expect(onCloseLogin).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Отменить вход" }));

    expect(onCancelLogin).toHaveBeenCalledWith("anthropic");
  });
});

describe("the four questions of a login", () => {
  const send = (): void => {
    fireEvent.click(screen.getByRole("button", { name: "Отправить ответ" }));
  };

  it("asks for a text and sends what was typed", () => {
    const { onAnswer } = show(
      asking({ stepId: "a1b2-1", kind: "text", message: "Имя организации" }),
    );

    fireEvent.change(screen.getByLabelText("Имя организации"), { target: { value: "acme" } });
    send();

    expect(onAnswer).toHaveBeenCalledWith("anthropic", "a1b2-1", "acme");
  });

  it("hides a secret while it is typed and says where it goes", () => {
    show(asking({ stepId: "a1b2-1", kind: "secret", message: "Ключ API" }));

    const field = screen.getByLabelText("Ключ API");

    expect(field).toHaveProperty("type", "password");
    expect(screen.getByText(/не показывается/)).toBeDefined();
  });

  it("sends the identifier of the chosen option, not its label", () => {
    // Ответом уезжает `id` (docs/models-and-providers.md): подпись видит человек, а провайдер ждёт
    // идентификатор.
    const { onAnswer } = show(
      asking({
        stepId: "a1b2-1",
        kind: "select",
        message: "Какой аккаунт",
        options: [
          { id: "personal", label: "Личный" },
          { id: "work", label: "Рабочий", description: "команда acme" },
        ],
      }),
    );

    fireEvent.click(screen.getByRole("combobox", { name: "Какой аккаунт" }));
    fireEvent.click(screen.getByText(/Рабочий/));
    send();

    expect(onAnswer).toHaveBeenCalledWith("anthropic", "a1b2-1", "work");
  });

  it("says where the code of a manual step comes from", () => {
    const { onAnswer } = show(
      asking({ stepId: "a1b2-1", kind: "manual-code", message: "Код из браузера" }),
    );

    expect(screen.getByText(/Забери код на странице провайдера/)).toBeDefined();
    fireEvent.change(screen.getByLabelText("Код из браузера"), { target: { value: "AB12" } });
    send();

    expect(onAnswer).toHaveBeenCalledWith("anthropic", "a1b2-1", "AB12");
  });

  it("keeps the secret out of the markup and out of the state once it is sent", () => {
    // Единственное место, куда уезжает значение, — тело `POST` (docs/models-and-providers.md).
    const state = asking({ stepId: "a1b2-1", kind: "secret", message: "Ключ API" });
    const { again, onAnswer } = show(state);

    fireEvent.change(screen.getByLabelText("Ключ API"), { target: { value: "sk-ant-secret" } });
    send();

    expect(onAnswer).toHaveBeenCalledWith("anthropic", "a1b2-1", "sk-ant-secret");

    // Ответ уехал — вопрос снимается, и вместе с ним исчезает единственное место, где значение
    // жило. В состоянии его не было ни на одном шаге.
    const answered = withLogin(state, {
      ...state.logins,
      dialogs: {
        anthropic: { attempt: attempt() },
      },
    });

    again(answered);

    expect(JSON.stringify(answered)).not.toContain("sk-ant-secret");
    expect(document.body.innerHTML).not.toContain("sk-ant-secret");
  });
});

describe("the four things a login says", () => {
  it("shows a message with the links it came with", () => {
    show(
      saying({
        kind: "info",
        message: "Разреши доступ в браузере",
        links: [{ url: "https://console.anthropic.com/keys", label: "Ключи" }],
      }),
    );

    const link = screen.getByRole("link", { name: "Ключи" });

    expect(screen.getByText("Разреши доступ в браузере")).toBeDefined();
    expect(link.getAttribute("href")).toBe("https://console.anthropic.com/keys");
    expect(link.getAttribute("rel")).toBe("noreferrer");
  });

  it("shows the address to log in at as a link, not as text", () => {
    show(
      saying({
        kind: "auth-url",
        url: "https://claude.ai/oauth/authorize",
        instructions: "Открой страницу входа",
      }),
    );

    expect(screen.getByText("Открой страницу входа")).toBeDefined();
    expect(
      screen.getByRole("link", { name: "https://claude.ai/oauth/authorize" }).getAttribute("rel"),
    ).toBe("noreferrer");
  });

  it("shows the device code, where to enter it and how long it is good for", () => {
    show(
      saying({
        kind: "device-code",
        userCode: "WDJB-MJHT",
        verificationUri: "https://github.com/login/device",
        expiresInSeconds: 900,
      }),
    );

    expect(screen.getByText("WDJB-MJHT")).toBeDefined();
    expect(screen.getByRole("link", { name: "https://github.com/login/device" })).toBeDefined();
    expect(screen.getByText(/900/)).toBeDefined();
    // Ожидание — это полоса, а не строка: сказать «идёт» и «ничего не происходит» это разные вещи.
    expect(
      screen.getByRole("progressbar", { name: "Ждём подтверждения от провайдера" }),
    ).toBeDefined();
  });

  it("shows progress as progress", () => {
    show(saying({ kind: "progress", message: "Меняем код на токен" }));

    expect(screen.getByRole("progressbar", { name: "Меняем код на токен" })).toBeDefined();
  });
});

describe("the end of a login", () => {
  it("says the login succeeded and lets the human put the dialog away", () => {
    const state = withProviders([provider("anthropic")]);
    const { onCloseLogin } = show(
      withLogin(state, {
        ...state.logins,
        dialogs: { anthropic: { attempt: attempt(), conclusion: { kind: "succeeded" } } },
      }),
    );

    expect(screen.getByText("Вход удался")).toBeDefined();
    fireEvent.click(screen.getByRole("button", { name: "Закрыть" }));

    expect(onCloseLogin).toHaveBeenCalledWith("anthropic");
  });

  it("tells a cancellation from a refusal of the provider", () => {
    const state = withProviders([provider("anthropic")]);

    show(
      withLogin(state, {
        ...state.logins,
        dialogs: {
          anthropic: { attempt: attempt(), conclusion: { kind: "cancelled" } },
          openai: {
            attempt: attempt({ providerId: "openai", attemptId: "c3d4" }),
            conclusion: { kind: "failed", reason: "the provider refused the key" },
          },
        },
      }),
    );

    expect(screen.getByText("Вход отменён")).toBeDefined();
    expect(screen.getByText(/the provider refused the key/)).toBeDefined();
  });

  it("says a step no longer waits for an answer instead of keeping quiet", () => {
    const state = asking({ stepId: "a1b2-1", kind: "text", message: "Имя организации" });

    show(
      withLogin(
        state,
        applyStaleAnswer(state.logins, "anthropic", "that login step is no longer waiting"),
      ),
    );

    expect(screen.getByText(/that login step is no longer waiting/)).toBeDefined();
    // Формы больше нет: отвечать этому шагу нечем, а форма обещала бы обратное.
    expect(screen.queryByRole("button", { name: "Отправить ответ" })).toBeNull();
  });

  it("says the login ended while the connection was down", () => {
    const state = withProviders([provider("anthropic")]);

    show(
      withLogin(state, {
        ...state.logins,
        dialogs: { anthropic: { attempt: attempt(), lost: true } },
      }),
    );

    expect(screen.getByText("Вход закончился, пока не было связи")).toBeDefined();
    expect(screen.getByRole("button", { name: "Закрыть" })).toBeDefined();
  });
});

describe("logging out of a provider", () => {
  const configured = (source?: string): ProvidersState =>
    withProviders([
      provider("anthropic", {
        auth: {
          kind: "configured",
          type: "api_key",
          ...(source === undefined ? {} : { source }),
        },
      }),
    ]);

  it("offers the way out only where there is a credential to remove", () => {
    const { onLogOut } = show(configured("stored credential"), "anthropic");

    fireEvent.click(screen.getByRole("button", { name: "Выйти из провайдера" }));

    expect(onLogOut).toHaveBeenCalledWith("anthropic");
  });

  it("offers no way out of a provider nobody logged into", () => {
    show(withProviders([provider("anthropic")]), "anthropic");

    expect(screen.queryByRole("button", { name: "Выйти из провайдера" })).toBeNull();
  });

  it("says the logout changed nothing and names the environment variable", () => {
    // Ловушка «нажал выход, ничего не изменилось»: кред из окружения платформе не принадлежит, и
    // убрать его нечем (docs/web-api.md).
    const state = configured("ANTHROPIC_API_KEY");
    const summary = state.snapshot?.providers[0];

    if (summary === undefined) {
      throw new Error("the provider is missing from the snapshot");
    }

    show(withLogin(state, applyLogout(state.logins, summary)), "anthropic");

    expect(screen.getByText("Выход ничего не изменил")).toBeDefined();
    // Имя переменной названо и в подписи строки, и в объяснении: спрашивается второе.
    expect(screen.getByText(/Кред приходит из ANTHROPIC_API_KEY/)).toBeDefined();
    expect(screen.getByText(/Убери его из окружения/)).toBeDefined();
  });

  it("says as much when the runtime did not name the source", () => {
    const state = configured();
    const summary = state.snapshot?.providers[0];

    if (summary === undefined) {
      throw new Error("the provider is missing from the snapshot");
    }

    show(withLogin(state, applyLogout(state.logins, summary)), "anthropic");

    expect(screen.getByText("Выход ничего не изменил")).toBeDefined();
    expect(screen.getByText(/провайдер остался настроенным/)).toBeDefined();
  });
});

describe("conflicting user providers", () => {
  it("asks for confirmation before deleting a definition missing from runtime", async () => {
    const state: ProvidersState = {
      ...withProviders([]),
      userProviders: {
        providers: [
          {
            definition: {
              id: "openai",
              name: "Saved OpenAI",
              baseUrl: "https://example.test/v1",
              api: "openai-responses",
              modelsEndpoint: { kind: "disabled" },
              modelDefaults: {
                contextWindow: 128_000,
                maxTokens: 8_192,
                reasoning: false,
                input: ["text"],
                cost: { input: 0, output: 0 },
              },
              manualModels: [],
              modelOverrides: {},
              disabledModelIds: [],
            },
            conflict: "provider identifier is already taken",
          },
        ],
      },
    };
    const { onDelete } = show(state);

    fireEvent.click(screen.getByRole("button", { name: "Удалить" }));
    expect(onDelete).not.toHaveBeenCalled();
    expect(screen.getByRole("dialog")).toBeDefined();
    fireEvent.click(screen.getAllByRole("button", { name: "Удалить" })[1]!);
    await waitFor(() => expect(onDelete).toHaveBeenCalledWith("openai"));
  });
});
