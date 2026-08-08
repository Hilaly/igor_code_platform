/** Какой способ ввода последним начал взаимодействие с документом. */
export type InputModality = "pointer" | "keyboard";

/** CSS-контракт reveal-компонентов UI-кита и приложения. */
export const inputModalityAttribute = "data-sovereign-input-modality";

/**
 * Помечает корень документа последним способом ввода. Браузерный `:focus-visible` зависит от своих
 * эвристик и настроек пользователя, поэтому указательный click в некоторых окружениях всё равно
 * оставляет его истинным. Явная modality отделяет keyboard-focus от обычного focus после click.
 */
export function trackInputModality(target: Document): () => void {
  const setModality = (modality: InputModality): void => {
    target.documentElement.setAttribute(inputModalityAttribute, modality);
  };
  const onPointerDown = (): void => setModality("pointer");
  const onKeyDown = (): void => setModality("keyboard");

  target.addEventListener("pointerdown", onPointerDown, true);
  target.addEventListener("keydown", onKeyDown, true);

  return () => {
    target.removeEventListener("pointerdown", onPointerDown, true);
    target.removeEventListener("keydown", onKeyDown, true);
  };
}
