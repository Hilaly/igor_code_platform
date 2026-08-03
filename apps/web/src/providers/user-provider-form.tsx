import {
  defaultModelsUrl,
  defaultUserModelDefinition,
  parseUserProviderDraft,
  type CustomProviderApi,
  type UserProviderDefinition,
} from "@sovereign/protocol";
import {
  Button,
  Field,
  Form,
  Heading,
  Input,
  Notice,
  Panel,
  Select,
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
  const [manualModels, setManualModels] = useState(
    props.initial?.manualModels.map((model) => model.id).join("\n") ?? "",
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
    setManualModels(props.initial.manualModels.map((model) => model.id).join("\n"));
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

  const submit = () => {
    let parsedOverrides: unknown;
    try {
      parsedOverrides = JSON.parse(modelOverrides);
    } catch {
      setDiagnostics([t("providers.user.overrides.invalid")]);
      return;
    }
    const defaults = {
      contextWindow: Number(contextWindow),
      maxTokens: Number(maxTokens),
      reasoning,
      input: imageInput ? (["text", "image"] as const) : (["text"] as const),
      cost: { input: Number(inputCost), output: Number(outputCost) },
    };
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
      manualModels: manualModels
        .split(/[,\n]/)
        .map((modelId) => modelId.trim())
        .filter(Boolean)
        .map(
          (modelId) =>
            props.initial?.manualModels.find((model) => model.id === modelId) ?? {
              id: modelId,
              name: modelId,
              ...defaults,
            },
        ),
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
      <Button onClick={props.onBack}>{props.translator.t("providers.back")}</Button>
      <Heading level={1}>
        {props.mode === "create" ? t("providers.user.new") : t("providers.user.edit", { id })}
      </Heading>
      {props.failure ? <Notice tone="danger" title={props.failure} /> : undefined}
      {diagnostics.length > 0 ? <Notice tone="danger" title={diagnostics.join("; ")} /> : undefined}
      <Panel>
        <Form onSubmit={submit} disabled={busy}>
          <Field label={t("providers.user.id")} hint={t("providers.user.id.hint")}>
            {(control) => (
              <Input {...control} value={id} onChange={setId} disabled={props.mode === "edit"} />
            )}
          </Field>
          <Field label={t("providers.user.name")}>
            {(control) => <Input {...control} value={name} onChange={setName} />}
          </Field>
          <Field label={t("providers.user.baseUrl")}>
            {(control) => <Input {...control} value={baseUrl} onChange={setBaseUrl} />}
          </Field>
          <Select
            value={api}
            options={apis}
            onChange={(value) => setApi(value as CustomProviderApi)}
            label={t("providers.user.api")}
            placeholder={t("providers.user.api.choose")}
          />
          <Toggle
            checked={automatic}
            onChange={setAutomatic}
            label={t("providers.user.models.automatic")}
          />
          {automatic ? (
            <Field
              label={t("providers.user.models.url")}
              hint={suggestedModelsUrl === "" ? undefined : `По умолчанию: ${suggestedModelsUrl}`}
            >
              {(control) => (
                <Input
                  {...control}
                  value={customModelsUrl}
                  onChange={setCustomModelsUrl}
                  placeholder={t("providers.user.models.url.placeholder")}
                />
              )}
            </Field>
          ) : undefined}
          <Field
            label={t("providers.user.models.manual")}
            hint={t("providers.user.models.manual.hint")}
          >
            {(control) => (
              <Textarea {...control} value={manualModels} onChange={setManualModels} rows={5} />
            )}
          </Field>
          <Heading level={2}>{t("providers.user.defaults")}</Heading>
          <Field label={t("providers.user.context")}>
            {(control) => <Input {...control} value={contextWindow} onChange={setContextWindow} />}
          </Field>
          <Field label={t("providers.user.maxTokens")}>
            {(control) => <Input {...control} value={maxTokens} onChange={setMaxTokens} />}
          </Field>
          <Toggle
            checked={reasoning}
            onChange={setReasoning}
            label={t("providers.user.reasoning")}
          />
          <Toggle
            checked={imageInput}
            onChange={setImageInput}
            label={t("providers.user.images")}
          />
          <Field label={t("providers.user.cost.input")}>
            {(control) => <Input {...control} value={inputCost} onChange={setInputCost} />}
          </Field>
          <Field label={t("providers.user.cost.output")}>
            {(control) => <Input {...control} value={outputCost} onChange={setOutputCost} />}
          </Field>
          <Field
            label={t("providers.user.models.disabled")}
            hint={t("providers.user.models.disabled.hint")}
          >
            {(control) => (
              <Textarea {...control} value={disabledModels} onChange={setDisabledModels} rows={4} />
            )}
          </Field>
          <Field label={t("providers.user.overrides")} hint={t("providers.user.overrides.hint")}>
            {(control) => (
              <Textarea {...control} value={modelOverrides} onChange={setModelOverrides} rows={8} />
            )}
          </Field>
          <Button tone="accent" type="submit" disabled={busy}>
            {busy ? t("providers.user.saving") : t("providers.user.save")}
          </Button>
        </Form>
      </Panel>
    </div>
  );
}
