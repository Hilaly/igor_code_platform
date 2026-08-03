import type {
  LoginAttemptState,
  LoginNotice,
  LoginPrompt,
  LoginStep,
  LoginStepFrame,
  ProviderSummary,
} from "@sovereign/protocol";
import { loginStepFrameKind } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import {
  applyAnswered,
  applyAnswerFailure,
  applyAttempts,
  applyLoginStep,
  applyLogout,
  applyStaleAnswer,
  applyStarted,
  applyStartFailure,
  applyTaken,
  closeLoginDialog,
  initialLoginsState,
  type LoginsState,
} from "./login-state.ts";

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

const frame = (step: LoginStep, overrides: Partial<LoginStepFrame> = {}): LoginStepFrame => ({
  index: 42,
  time: "2026-07-29T09:11:04.512Z",
  frame: loginStepFrameKind,
  attemptId: "a1b2",
  providerId: "anthropic",
  step,
  ...overrides,
});

const prompt = (overrides: Partial<LoginPrompt> = {}): LoginPrompt =>
  ({ stepId: "a1b2-1", kind: "secret", message: "Ключ API", ...overrides }) as LoginPrompt;

const progress: LoginNotice = { kind: "progress", message: "ждём" };

const running = (state: LoginsState = initialLoginsState): LoginsState =>
  applyStarted(state, attempt());

const provider = (auth: ProviderSummary["auth"]): ProviderSummary => ({
  id: "anthropic",
  name: "Anthropic",
  logins: [{ type: "oauth", label: "Sign in" }],
  auth,
  dynamic: false,
  custom: false,
  origin: "builtin",
  modelCount: 2,
});

describe("applyStarted", () => {
  it("opens a dialog on the provider being logged into", () => {
    const state = applyStarted(applyStartFailure(initialLoginsState, "boom"), attempt());

    expect(state.dialogs["anthropic"]?.attempt.attemptId).toBe("a1b2");
    // Причина прошлого отказа уходит: она была про попытку, которой больше нет.
    expect(state.failure).toBeUndefined();
  });
});

describe("applyTaken", () => {
  it("keeps the running attempt whole: the refusal has to name who took the provider", () => {
    const state = applyTaken(initialLoginsState, attempt({ origin: "plugin", answerable: false }));
    const dialog = state.dialogs["anthropic"];

    expect(dialog?.taken).toBe(true);
    expect(dialog?.attempt.origin).toBe("plugin");
    expect(dialog?.attempt.answerable).toBe(false);
  });

  it("lets the same session carry on the login it started in another tab", () => {
    // Отвечает владелец попытки — сессия, а не вкладка: вопросы этой попытки отсюда доступны.
    const state = applyTaken(initialLoginsState, attempt({ pending: prompt() }));

    expect(state.dialogs["anthropic"]?.attempt.answerable).toBe(true);
    expect(state.dialogs["anthropic"]?.attempt.pending?.stepId).toBe("a1b2-1");
  });
});

describe("applyLoginStep", () => {
  it("puts the question of the frame in front of the human", () => {
    const outcome = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() }));

    expect(outcome.refetch).toBe(false);
    expect(outcome.state.dialogs["anthropic"]?.attempt.pending).toEqual(prompt());
  });

  it("piles up what was said in the order it was said", () => {
    const first = applyLoginStep(running(), frame({ kind: "notice", notice: progress }));
    const second = applyLoginStep(
      first.state,
      frame({ kind: "notice", notice: { kind: "info", message: "почти" } }),
    );

    expect(second.state.dialogs["anthropic"]?.attempt.notices).toEqual([
      progress,
      { kind: "info", message: "почти" },
    ]);
  });

  it("keeps the conclusion and takes the question away with it", () => {
    const asked = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() }));
    const done = applyLoginStep(
      asked.state,
      frame({ kind: "conclusion", conclusion: { kind: "failed", reason: "refused" } }),
    );
    const dialog = done.state.dialogs["anthropic"];

    expect(dialog?.conclusion).toEqual({ kind: "failed", reason: "refused" });
    expect(dialog?.attempt.pending).toBeUndefined();
  });

  it("asks for the running attempts instead of building one out of a single step", () => {
    // Вход начали в другой вкладке той же сессии: в кадре нет ни сказанного до него, ни способа
    // входа, и собранная из него попытка была бы огрызком.
    const outcome = applyLoginStep(initialLoginsState, frame({ kind: "notice", notice: progress }));

    expect(outcome.refetch).toBe(true);
    expect(outcome.state.dialogs["anthropic"]).toBeUndefined();
  });

  it("drops a frame of an attempt that is not the one on screen", () => {
    const outcome = applyLoginStep(
      running(),
      frame({ kind: "notice", notice: progress }, { attemptId: "other" }),
    );

    expect(outcome.refetch).toBe(true);
    expect(outcome.state.dialogs["anthropic"]?.attempt.notices).toEqual([]);
  });
});

describe("applyAttempts", () => {
  it("restores the dialog from the snapshot: the frame may have gone into the gap", () => {
    const restored = applyAttempts(initialLoginsState, {
      attempts: [attempt({ notices: [progress], pending: prompt() })],
    });
    const dialog = restored.dialogs["anthropic"];

    expect(dialog?.attempt.notices).toEqual([progress]);
    expect(dialog?.attempt.pending).toEqual(prompt());
  });

  it("replaces what the tab holds with what the daemon holds", () => {
    const stale = applyLoginStep(running(), frame({ kind: "notice", notice: progress })).state;
    const restored = applyAttempts(stale, {
      attempts: [attempt({ notices: [progress, { kind: "info", message: "и ещё" }] })],
    });

    expect(restored.dialogs["anthropic"]?.attempt.notices).toHaveLength(2);
  });

  it("says outright that a login ended while the connection was down", () => {
    // Реестр держит только идущие попытки: пропавшая из снимка кончилась, а чем — сказать нечем.
    const restored = applyAttempts(running(), { attempts: [] });
    const dialog = restored.dialogs["anthropic"];

    expect(dialog?.lost).toBe(true);
    expect(dialog?.conclusion).toBeUndefined();
  });

  it("keeps a conclusion the human has not read yet", () => {
    const done = applyLoginStep(
      running(),
      frame({ kind: "conclusion", conclusion: { kind: "succeeded" } }),
    ).state;
    const restored = applyAttempts(done, { attempts: [] });

    expect(restored.dialogs["anthropic"]?.conclusion).toEqual({ kind: "succeeded" });
    expect(restored.dialogs["anthropic"]?.lost).toBeUndefined();
  });
});

describe("applyAnswered", () => {
  it("takes the question away as soon as the answer is gone: no next frame may come at all", () => {
    const asked = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() })).state;
    const state = applyAnswered(asked, "anthropic", "a1b2-1");

    expect(state.dialogs["anthropic"]?.attempt.pending).toBeUndefined();
  });

  it("leaves the current question alone when the answer was to the previous one", () => {
    const asked = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() })).state;
    const state = applyAnswered(asked, "anthropic", "a1b2-0");

    expect(state.dialogs["anthropic"]?.attempt.pending?.stepId).toBe("a1b2-1");
  });
});

describe("applyStaleAnswer", () => {
  it("says the step no longer waits instead of keeping a form that answers nothing", () => {
    const asked = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() })).state;
    const state = applyStaleAnswer(asked, "anthropic", "that login step is no longer waiting");
    const dialog = state.dialogs["anthropic"];

    expect(dialog?.refusal).toBe("that login step is no longer waiting");
    expect(dialog?.attempt.pending).toBeUndefined();
  });
});

describe("applyAnswerFailure", () => {
  it("keeps the question: the answer did not reach the daemon, and sending it again makes sense", () => {
    const asked = applyLoginStep(running(), frame({ kind: "prompt", prompt: prompt() })).state;
    const state = applyAnswerFailure(asked, "anthropic", "failed to fetch");
    const dialog = state.dialogs["anthropic"];

    expect(dialog?.refusal).toBe("failed to fetch");
    expect(dialog?.attempt.pending?.stepId).toBe("a1b2-1");
  });
});

describe("applyLogout", () => {
  it("marks a provider that stayed configured: the credential is not the platform's to remove", () => {
    const state = applyLogout(
      initialLoginsState,
      provider({ kind: "configured", type: "api_key", source: "ANTHROPIC_API_KEY" }),
    );

    expect(state.stubborn["anthropic"]).toEqual({ source: "ANTHROPIC_API_KEY" });
  });

  it("says nothing when the logout did what it was asked to", () => {
    const marked = applyLogout(initialLoginsState, provider({ kind: "configured", type: "oauth" }));
    const state = applyLogout(marked, provider({ kind: "unconfigured" }));

    expect(state.stubborn["anthropic"]).toBeUndefined();
  });
});

describe("closeLoginDialog", () => {
  it("closes a dialog that is over", () => {
    const done = applyLoginStep(
      running(),
      frame({ kind: "conclusion", conclusion: { kind: "cancelled" } }),
    ).state;

    expect(closeLoginDialog(done, "anthropic").dialogs["anthropic"]).toBeUndefined();
  });

  it("refuses to hide a login that is still going: it is cancelled, not closed", () => {
    expect(closeLoginDialog(running(), "anthropic").dialogs["anthropic"]).toBeDefined();
  });
});
