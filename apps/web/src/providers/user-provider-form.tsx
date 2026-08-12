import {
  defaultModelsUrl,
  defaultUserModelDefinition,
  parseUserProviderDraft,
  type CustomProviderApi,
  type CustomModelDefinition,
  type UserProviderDefinition,
} from "@sovereign/protocol";
import {
  Button,
  Form,
  Heading,
  Input,
  Notice,
  Select,
  SettingsRow,
  Text,
  Textarea,
  Toggle,
  type ScopedTranslator,
} from "@sovereign/ui-kit";
import { useEffect, useState } from "react";

const apis: { value: CustomProviderApi; label: string }[] = [
  { value: "openai-completions", label: "OpenAI Chat Completions" },
  { value: "openai-responses", label: "OpenAI Responses" },
  { value: "anthropic-messages", label: "Anthropic Messages" },
  { value: "google-generative-ai", label: "Google Generative AI" },
];

export type UserProviderFormProps = {
  mode: "create" | "edit";
  initial?: UserProviderDefinition;
  loading?: boolean;
  failure?: string;
  onBack: () => void;
  onSubmit: (definition: UserProviderDefinition) => Promise<void>;
  translator: ScopedTranslator;
};

export function UserProviderForm(props: UserProviderFormProps) {
  const [id, setId] = useState(props.initial?.id ?? "");
  const [name, setName] = useState(props.initial?.name ?? "");
  const [baseUrl, setBaseUrl] = useState(props.initial?.baseUrl ?? "");
  const [api, setApi] = useState<CustomProviderApi>(props.initial?.api ?? "openai-responses");
  const [automatic, setAutomatic] = useState(props.initial?.modelsEndpoint.kind !== "disabled");
  const [customModelsUrl, setCustomModelsUrl] = useState(
    props.initial?.modelsEndpoint.kind === "custom" ? props.initial.modelsEndpoint.url : "",
  );
  const [manualModels, setManualModels] = useState<CustomModelDefinition[]>(
    props.initial?.manualModels ?? [],
  );
  const [contextWindow, setContextWindow] = useState(
    String(props.initial?.modelDefaults.contextWindow ?? defaultUserModelDefinition.contextWindow),
  );
  const [maxTokens, setMaxTokens] = useState(
    String(props.initial?.modelDefaults.maxTokens ?? defaultUserModelDefinition.maxTokens),
  );
  const [reasoning, setReasoning] = useState(
    props.initial?.modelDefaults.reasoning ?? defaultUserModelDefinition.reasoning,
  );
  const [imageInput, setImageInput] = useState(
    props.initial?.modelDefaults.input.includes("image") ?? false,
  );
  const [inputCost, setInputCost] = useState(
    String(props.initial?.modelDefaults.cost.input ?? defaultUserModelDefinition.cost.input),
  );
  const [outputCost, setOutputCost] = useState(
    String(props.initial?.modelDefaults.cost.output ?? defaultUserModelDefinition.cost.output),
  );
  const [disabledModels, setDisabledModels] = useState(
    props.initial?.disabledModelIds.join("\n") ?? "",
  );
  const [modelOverrides, setModelOverrides] = useState(
    JSON.stringify(props.initial?.modelOverrides ?? {}, undefined, 2),
  );
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const { t } = props.translator;

  useEffect(() => {
    if (props.initial === undefined) return;
    setId(props.initial.id);
    setName(props.initial.name);
    setBaseUrl(props.initial.baseUrl);
    setApi(props.initial.api);
    setAutomatic(props.initial.modelsEndpoint.kind !== "disabled");
    setCustomModelsUrl(
      props.initial.modelsEndpoint.kind === "custom" ? props.initial.modelsEndpoint.url : "",
    );
    setManualModels(props.initial.manualModels);
    setContextWindow(String(props.initial.modelDefaults.contextWindow));
    setMaxTokens(String(props.initial.modelDefaults.maxTokens));
    setReasoning(props.initial.modelDefaults.reasoning);
    setImageInput(props.initial.modelDefaults.input.includes("image"));
    setInputCost(String(props.initial.modelDefaults.cost.input));
    setOutputCost(String(props.initial.modelDefaults.cost.output));
    setDisabledModels(props.initial.disabledModelIds.join("\n"));
    setModelOverrides(JSON.stringify(props.initial.modelOverrides, undefined, 2));
  }, [props.initial]);

  const suggestedModelsUrl = (() => {
    try {
      return baseUrl.trim() === "" ? "" : defaultModelsUrl(api, baseUrl);
    } catch {
      return "";
    }
  })();
  const defaults = {
    contextWindow: Number(contextWindow),
    maxTokens: Number(maxTokens),
    reasoning,
    input: imageInput ? (["text", "image"] as const) : (["text"] as const),
    cost: { input: Number(inputCost), output: Number(outputCost) },
  };

  const submit = () => {
    let parsedOverrides: unknown;
    try {
      parsedOverrides = JSON.parse(modelOverrides);
    } catch {
      setDiagnostics([t("providers.user.overrides.invalid")]);
      return;
    }
    const candidate = {
      id,
      name,
      baseUrl,
      api,
      modelsEndpoint: !automatic
        ? ({ kind: "disabled" } as const)
        : customModelsUrl.trim() === ""
          ? ({ kind: "default" } as const)
          : ({ kind: "custom", url: customModelsUrl } as const),
      modelDefaults: defaults,
      manualModels,
      modelOverrides: parsedOverrides,
      disabledModelIds: disabledModels
        .split(/[,\n]/)
        .map((modelId) => modelId.trim())
        .filter(Boolean),
    };
    const parsed = parseUserProviderDraft(candidate);
    if (parsed.kind === "rejected") {
      setDiagnostics(parsed.diagnostics);
      return;
    }
    setDiagnostics([]);
    setBusy(true);
    void props.onSubmit(parsed.value).finally(() => setBusy(false));
  };

  if (props.loading) return <Text>{props.translator.t("state.loading")}</Text>;

  return (
    <div className="providers provider-form-page">
      <div className="provider-form-toolbar">
        <Button onClick={props.onBack}>{props.translator.t("providers.back")}</Button>
      </div>
      {props.failure ? <Notice tone="danger" title={props.failure} /> : undefined}
      {diagnostics.length > 0 ? <Notice tone="danger" title={diagnostics.join("; ")} /> : undefined}
      <Form onSubmit={submit} disabled={busy}>
        <div className="provider-form-rows">
          <SettingsRow
            label={<span>{t("providers.user.id")}</span>}
            description={t("providers.user.id.hint")}
          >
            <Input
              aria-label={t("providers.user.id")}
              value={id}
              onChange={setId}
              disabled={props.mode === "edit"}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.name")}</span>}>
            <Input aria-label={t("providers.user.name")} value={name} onChange={setName} />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.baseUrl")}</span>}>
            <Input aria-label={t("providers.user.baseUrl")} value={baseUrl} onChange={setBaseUrl} />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.api")}</span>}>
            <Select
              value={api}
              options={apis}
              onChange={(value) => setApi(value as CustomProviderApi)}
              label=""
              ariaLabel={t("providers.user.api")}
              placeholder={t("providers.user.api.choose")}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.models.automatic")}</span>}>
            <Toggle
              checked={automatic}
              onChange={setAutomatic}
              label={t("providers.user.models.automatic")}
              labelDisplay="tooltip"
            />
          </SettingsRow>
          {automatic ? (
            <SettingsRow
              label={<span>{t("providers.user.models.url")}</span>}
              description={
                suggestedModelsUrl === "" ? undefined : `По умолчанию: ${suggestedModelsUrl}`
              }
            >
              <Input
                aria-label={t("providers.user.models.url")}
                value={customModelsUrl}
                onChange={setCustomModelsUrl}
                placeholder={t("providers.user.models.url.placeholder")}
              />
            </SettingsRow>
          ) : undefined}
          <ManualModelsEditor
            models={manualModels}
            defaults={defaults}
            onChange={setManualModels}
            translator={props.translator}
          />
          <div className="provider-form-section-label">
            <Heading level={3}>{t("providers.user.defaults")}</Heading>
          </div>
          <SettingsRow label={<span>{t("providers.user.context")}</span>}>
            <Input
              aria-label={t("providers.user.context")}
              value={contextWindow}
              onChange={setContextWindow}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.maxTokens")}</span>}>
            <Input
              aria-label={t("providers.user.maxTokens")}
              value={maxTokens}
              onChange={setMaxTokens}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.reasoning")}</span>}>
            <Toggle
              checked={reasoning}
              onChange={setReasoning}
              label={t("providers.user.reasoning")}
              labelDisplay="tooltip"
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.images")}</span>}>
            <Toggle
              checked={imageInput}
              onChange={setImageInput}
              label={t("providers.user.images")}
              labelDisplay="tooltip"
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.cost.input")}</span>}>
            <Input
              aria-label={t("providers.user.cost.input")}
              value={inputCost}
              onChange={setInputCost}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.cost.output")}</span>}>
            <Input
              aria-label={t("providers.user.cost.output")}
              value={outputCost}
              onChange={setOutputCost}
            />
          </SettingsRow>
          <SettingsRow
            label={<span>{t("providers.user.models.disabled")}</span>}
            description={t("providers.user.models.disabled.hint")}
          >
            <Textarea
              aria-label={t("providers.user.models.disabled")}
              value={disabledModels}
              onChange={setDisabledModels}
              rows={4}
            />
          </SettingsRow>
          <SettingsRow
            label={<span>{t("providers.user.overrides")}</span>}
            description={t("providers.user.overrides.hint")}
          >
            <Textarea
              aria-label={t("providers.user.overrides")}
              value={modelOverrides}
              onChange={setModelOverrides}
              rows={8}
            />
          </SettingsRow>
          <div className="provider-form-actions">
            <Button tone="accent" type="submit" disabled={busy}>
              {busy ? t("providers.user.saving") : t("providers.user.save")}
            </Button>
          </div>
        </div>
      </Form>
    </div>
  );
}

function ManualModelsEditor({
  models,
  defaults,
  onChange,
  translator,
}: {
  models: CustomModelDefinition[];
  defaults: {
    contextWindow: number;
    maxTokens: number;
    reasoning: boolean;
    input: readonly ("text" | "image")[];
    cost: { input: number; output: number };
  };
  onChange: (models: CustomModelDefinition[]) => void;
  translator: ScopedTranslator;
}) {
  const { t } = translator;
  const update = (index: number, patch: Partial<CustomModelDefinition>) =>
    onChange(
      models.map((model, position) => (position === index ? { ...model, ...patch } : model)),
    );

  return (
    <section className="provider-manual-models" aria-label={t("providers.user.models.manual")}>
      <div className="provider-form-section-label">
        <Heading level={3}>{t("providers.user.models.manual")}</Heading>
        <Text tone="muted">{t("providers.user.models.manual.hint")}</Text>
      </div>
      {models.map((model, index) => (
        <div className="provider-manual-model" key={index}>
          <div className="provider-form-section-label">
            <Text>{model.name || model.id || t("providers.user.models.unnamed")}</Text>
          </div>
          <SettingsRow label={<span>{t("providers.user.model.id")}</span>}>
            <Input
              aria-label={t("providers.user.model.id")}
              value={model.id}
              onChange={(id) => update(index, { id })}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.model.name")}</span>}>
            <Input
              aria-label={t("providers.user.model.name")}
              value={model.name}
              onChange={(name) => update(index, { name })}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.context")}</span>}>
            <Input
              aria-label={t("providers.user.context")}
              value={String(model.contextWindow)}
              onChange={(value) => update(index, { contextWindow: Number(value) })}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.maxTokens")}</span>}>
            <Input
              aria-label={t("providers.user.maxTokens")}
              value={String(model.maxTokens)}
              onChange={(value) => update(index, { maxTokens: Number(value) })}
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.reasoning")}</span>}>
            <Toggle
              checked={model.reasoning ?? false}
              onChange={(reasoning) => update(index, { reasoning })}
              label={t("providers.user.reasoning")}
              labelDisplay="tooltip"
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.images")}</span>}>
            <Toggle
              checked={(model.input ?? ["text"]).includes("image")}
              onChange={(image) => update(index, { input: image ? ["text", "image"] : ["text"] })}
              label={t("providers.user.images")}
              labelDisplay="tooltip"
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.cost.input")}</span>}>
            <Input
              aria-label={t("providers.user.cost.input")}
              value={String(model.cost?.input ?? 0)}
              onChange={(value) =>
                update(index, { cost: { input: Number(value), output: model.cost?.output ?? 0 } })
              }
            />
          </SettingsRow>
          <SettingsRow label={<span>{t("providers.user.cost.output")}</span>}>
            <Input
              aria-label={t("providers.user.cost.output")}
              value={String(model.cost?.output ?? 0)}
              onChange={(value) =>
                update(index, { cost: { input: model.cost?.input ?? 0, output: Number(value) } })
              }
            />
          </SettingsRow>
          <div className="provider-form-actions">
            <Button
              tone="danger"
              onClick={() => onChange(models.filter((_, position) => position !== index))}
            >
              {t("providers.user.model.remove")}
            </Button>
          </div>
        </div>
      ))}
      <div className="provider-form-actions">
        <Button
          onClick={() =>
            onChange([
              ...models,
              {
                id: "",
                name: "",
                contextWindow: defaults.contextWindow,
                maxTokens: defaults.maxTokens,
                reasoning: defaults.reasoning,
                input: [...defaults.input],
                cost: { ...defaults.cost },
              },
            ])
          }
        >
          + {t("providers.user.model.add")}
        </Button>
      </div>
    </section>
  );
}
