import { log, providers, type PluginModule } from "@sovereign/sdk";

export const activate: PluginModule["activate"] = async () => {
  const list = await providers.list();
  const models = await providers.models("anthropic");
  const status = await providers.status("anthropic");
  const nobody = await providers.models("выдуманный");
  const report = await providers.refresh();

  await log.info("provider-reader looked around", {
    providers: list.length,
    scripted: list.some((provider) => provider.id === "scripted"),
    models: (models ?? []).length,
    model: models?.[0]?.providerId,
    status: status?.kind,
    nobody: nobody === undefined,
    // Значения креда в поверхности нет: у сводки провайдера есть только статус.
    secrets: list.filter((provider) => Object.keys(provider).includes("credential")).length,
    refreshed: report.refreshed.length,
  });
};
