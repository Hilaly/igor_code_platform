/**
 * Разметка ссылки серверной отрисовкой: `target` и `rel` глазами не проверяются, а стоят они ровно
 * на внешней ссылке. Внутренняя обязана остаться обычной — новая вкладка на каждый переход внутри
 * платформы это не безопасность, а мусор в браузере.
 */

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Link } from "./link.tsx";

describe("Link", () => {
  it("sends an external link to a new tab without handing over the referrer", () => {
    const markup = renderToStaticMarkup(
      <Link href="https://claude.ai/oauth/authorize" external>
        Войти у провайдера
      </Link>,
    );

    expect(markup).not.toContain("undefined");
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('href="https://claude.ai/oauth/authorize"');
  });

  it("leaves a link inside the platform alone", () => {
    const markup = renderToStaticMarkup(<Link href="/providers">Провайдеры</Link>);

    expect(markup).not.toContain("undefined");
    expect(markup).not.toContain("rel=");
    expect(markup).not.toContain("target=");
  });
});
