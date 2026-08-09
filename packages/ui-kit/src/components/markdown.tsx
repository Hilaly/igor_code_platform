/**
 * Размётка ответа агента. Это единственный примитив, который показывает текст, написанный не нами и
 * не человеком за клавиатурой: модель пересказывает файлы проекта, а в них лежит что угодно.
 * Поэтому сырой HTML сюда не проходит дважды — `rehype-raw` не подключён, и остатки чистит
 * санитайзер (docs/ui-kit.md, «Почему так»).
 *
 * Разметку рисуют примитивы кита там, где примитив есть: ссылка, код, заголовок. Остальное —
 * абзацы, списки, таблица, цитата — остаётся своими тегами и одевается из `markdown.module.css`:
 * `Text` — строчный `span`, и абзац им не собрать.
 */

import { memo, type ReactNode } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSanitize, { defaultSchema } from "rehype-sanitize";
import remarkGfm from "remark-gfm";

import { Code, CodeBlock } from "./code.tsx";
import { Heading } from "./text.tsx";
import { Link } from "./link.tsx";
import styles from "./markdown.module.css";

/**
 * Схема по умолчанию пропускает `irc` и `xmpp`; чат агента — не то место, где полезна ссылка,
 * открывающая стороннее приложение. Оставлены три схемы, которые браузер откроет сам.
 */
const schema = {
  ...defaultSchema,
  protocols: {
    ...defaultSchema.protocols,
    href: ["http", "https", "mailto"],
  },
};

/** Текст поддерева hast: `pre` показывается целиком строкой, а не разбирается по узлам. */
function textOf(node: unknown): string {
  if (typeof node !== "object" || node === null) {
    return "";
  }

  const candidate = node as { value?: unknown; children?: unknown };

  if (typeof candidate.value === "string") {
    return candidate.value;
  }

  return Array.isArray(candidate.children) ? candidate.children.map(textOf).join("") : "";
}

/**
 * Заголовок реплики сдвинут на уровень вниз: `h1` на странице уже занят оболочкой, и второй сломал
 * бы обход по заголовкам. Уровней у кита три, поэтому `h3` и глубже сходятся в один — разницу между
 * четвёртым и пятым уровнем в реплике чата всё равно нечем показать.
 */
const headingComponents: Pick<Components, "h1" | "h2" | "h3" | "h4" | "h5" | "h6"> = {
  h1: ({ children }) => <Heading level={2}>{children}</Heading>,
  h2: ({ children }) => <Heading level={3}>{children}</Heading>,
  h3: ({ children }) => <Heading level={3}>{children}</Heading>,
  h4: ({ children }) => <Heading level={3}>{children}</Heading>,
  h5: ({ children }) => <Heading level={3}>{children}</Heading>,
  h6: ({ children }) => <Heading level={3}>{children}</Heading>,
};

const components: Components = {
  ...headingComponents,
  // Ссылка из ответа модели всегда внешняя: свои адреса приходят навигацией, а не разметкой.
  a: ({ href, children }) => (
    <Link href={href ?? ""} external>
      {children}
    </Link>
  ),
  // Ограждённый блок целиком отдаётся `CodeBlock`; вложенный `code` до `components` уже не дойдёт.
  pre: ({ node }) => <CodeBlock>{textOf(node)}</CodeBlock>,
  code: ({ node }) => <Code>{textOf(node)}</Code>,
};

export type MarkdownProps = {
  /** Размётка как есть, из ответа модели. Своих строк у примитива нет и быть не может. */
  text: string;
};

export const Markdown = memo(function Markdown({ text }: MarkdownProps): ReactNode {
  return (
    <div className={styles.root}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[[rehypeSanitize, schema]]}
        components={components}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
});
