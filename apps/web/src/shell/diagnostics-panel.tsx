/** Вкладка диагностики: то, что в демоне ушло бы в журнал, а в браузере уходить некуда. */

import { EmptyState, List, ListRow, Text, type ScopedTranslator } from "@sovereign/ui-kit";

import type { Diagnostic } from "../diagnostics.ts";

export type DiagnosticsPanelProps = {
  diagnostics: Diagnostic[];
  translator: ScopedTranslator;
};

export function DiagnosticsPanel({ diagnostics, translator }: DiagnosticsPanelProps) {
  if (diagnostics.length === 0) {
    return <EmptyState title={translator.t("diagnostics.empty")} />;
  }

  return (
    <List>
      {diagnostics.map((diagnostic) => (
        <ListRow key={diagnostic.index}>
          <Text tone="muted">{diagnostic.text}</Text>
        </ListRow>
      ))}
    </List>
  );
}
