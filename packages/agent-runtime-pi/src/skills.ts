/** Метаданные скила, уже разрешённого ядром для конкретной сессии. */
export type AgentSkill = {
  name: string;
  description: string;
  /** Абсолютный путь к `SKILL.md`, который модель при необходимости читает обычным `read`. */
  location: string;
  disableModelInvocation?: boolean;
};

/** Компактный каталог для progressive disclosure: инструкции скилов в prompt не копируются. */
export function renderSkillCatalogue(skills: readonly AgentSkill[]): string {
  const visible = skills
    .filter((skill) => skill.disableModelInvocation !== true)
    .toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));

  if (visible.length === 0) {
    return "";
  }

  const entries = visible.map(
    (skill) =>
      `  <skill>\n    <name>${escapeXml(skill.name)}</name>\n    <description>${escapeXml(skill.description)}</description>\n    <location>${escapeXml(skill.location)}</location>\n  </skill>`,
  );

  return `<available_skills>\n${entries.join("\n")}\n</available_skills>`;
}

function escapeXml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&apos;",
      })[character] ?? character,
  );
}
