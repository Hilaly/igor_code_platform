import { Menu, StatusDot, type ScopedTranslator } from "@sovereign/ui-kit";

import type { StreamStatus } from "../events/stream.ts";

export type AccountControlProps = {
  stream: StreamStatus;
  failure?: string;
  onOpenArchive: () => void;
  onOpenSettings: () => void;
  onLogOut: () => void;
  translator: ScopedTranslator;
};

export function AccountControl({
  stream,
  failure,
  onOpenArchive,
  onOpenSettings,
  onLogOut,
  translator,
}: AccountControlProps) {
  const failed = failure !== undefined || stream === "reconnecting";
  const tone = failed ? "danger" : stream === "open" ? "positive" : "pending";
  const label = failure === undefined ? translator.t(`connection.${stream}`) : failure;

  return (
    <div className="shell-account">
      <span className="shell-account-status">
        <StatusDot tone={tone} label={label} />
      </span>
      <Menu
        label={translator.t("account.menu")}
        trigger={translator.t("account.menu")}
        placement="above"
        block
        items={[
          {
            id: "archive",
            label: translator.t("sessions.archive.title"),
            onSelect: onOpenArchive,
          },
          {
            id: "settings",
            label: translator.t("settings.title"),
            onSelect: onOpenSettings,
          },
          {
            id: "log-out",
            label: translator.t("logout"),
            tone: "danger",
            onSelect: onLogOut,
          },
        ]}
      />
    </div>
  );
}
