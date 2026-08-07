/**
 * Раздел «Диагностика» страницы настроек: то, что в демоне ушло бы в журнал, а в браузере уходить
 * некуда. Прежде это была вкладка `diagnostics` правой панели; логика не менялась.
 */

import type { ScopedTranslator } from "@sovereign/ui-kit";

import type { Diagnostic } from "../diagnostics.ts";

export type DiagnosticsSectionProps = {
  diagnostics: Diagnostic[];
  translator: ScopedTranslator;
};

export function DiagnosticsSection({ diagnostics, translator }: DiagnosticsSectionProps) {
  if (diagnostics.length === 0) {
    return (
      <p className="settings-diagnostics-empty" role="status">
        {translator.t("diagnostics.empty")}
      </p>
    );
  }

  return (
    <ol className="settings-diagnostics-stream" aria-label={translator.t("diagnostics.title")}>
      {diagnostics.map((diagnostic) => (
        <li key={diagnostic.index}>
          <span className="settings-diagnostics-index" aria-hidden="true">
            {diagnostic.index.toString().padStart(3, "0")}
          </span>
          <code>{diagnostic.text}</code>
        </li>
      ))}
    </ol>
  );
}
