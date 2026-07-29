import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { builtinModels } from "@earendil-works/pi-ai/providers/all";

// Тест дымовой намеренно: он проверяет не наш код, а то, что чужой пакет вообще пригоден —
// резолвится при nodenext, отдаёт каталог провайдеров и не ходит в сеть на построении.
// Сломается он при обновлении Pi, и это ровно тот момент, когда об этом надо узнать.
describe("builtinModels", () => {
  it("brings the whole provider catalogue in one call", () => {
    const providers = builtinModels().getProviders();

    assert.ok(
      providers.length >= 38,
      `ожидалось не меньше 38 провайдеров, пришло ${String(providers.length)}`,
    );
    assert.ok(providers.some((provider) => provider.id === "anthropic"));
  });

  it("builds without a credential store and without reaching the network", () => {
    const anthropic = builtinModels().getProvider("anthropic");

    assert.ok(anthropic);
    // Список моделей у anthropic статический: он лежит в пакете и читается синхронно,
    // до всякой авторизации. Динамические провайдеры до refreshModels() отдают пустой список.
    assert.ok(anthropic.getModels().length > 0);
  });
});
