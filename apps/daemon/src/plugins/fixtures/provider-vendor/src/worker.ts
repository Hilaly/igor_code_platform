import { log, providers, type CustomProviderDefinition, type PluginModule } from "@sovereign/sdk";

const vendor: CustomProviderDefinition = {
  id: "vendor-local",
  name: "Vendor Local",
  baseUrl: "http://127.0.0.1:11434/v1",
  api: "openai-completions",
  apiKey: { label: "Vendor key", environmentVariables: ["VENDOR_API_KEY"] },
  models: [
    { id: "vendor-large", name: "Vendor Large", contextWindow: 32_000, maxTokens: 4_096 },
    { id: "vendor-small", name: "Vendor Small", contextWindow: 8_000, maxTokens: 1_024 },
  ],
};

export const activate: PluginModule["activate"] = async () => {
  // Регистрация в `activate` — та же механика, что у подписок на шину: выгрузка забирает провайдера,
  // возврат регистрирует его заново.
  await providers.register(vendor);

  let refusal = "";

  try {
    // Занятый идентификатор — отказ операции, а не замена встроенного провайдера.
    await providers.register({ ...vendor, id: "anthropic" });
  } catch (cause) {
    refusal = cause instanceof Error ? cause.message : String(cause);
  }

  const list = await providers.list();
  const models = await providers.models(vendor.id);

  await log.info("provider-vendor registered a provider", {
    custom: list.filter((provider) => provider.custom).map((provider) => provider.id),
    models: models?.map((model) => model.id),
    refusal,
  });
};
