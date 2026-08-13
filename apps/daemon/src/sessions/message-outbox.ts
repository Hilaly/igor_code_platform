/**
 * Очередь сообщений сессии (docs/sessions-and-projects.md).
 *
 * То, что человек отправил, пока сессия была занята. Освободившись, сессия забирает голову очереди
 * и запускает ею турн — этим очередь и отличается от очередей рантайма, которые лишь ждут, пока
 * турн придёт за ними сам.
 *
 * Структура ничего не знает ни о сессиях, ни о походах к модели — ровно как `TurnQueue`: кто и
 * когда сливает очередь, решает служба сессий, а здесь только порядок и состояние.
 */

import type {
  SessionImage,
  SessionOutbox,
  SessionOutboxMessage,
  ThinkingLevel,
} from "@sovereign/protocol";

export type OutboxRequest = {
  text: string;
  images?: SessionImage[];
  model?: string;
  thinkingLevel?: ThinkingLevel;
};

export type MessageOutbox = {
  /** Поставить сообщение в хвост. Идентификатор выдаёт очередь: по нему сообщение потом адресуют. */
  enqueue: (sessionId: string, message: OutboxRequest) => SessionOutboxMessage;
  /** Снимок очереди одной сессии. Пустая очередь — законный снимок, а не отсутствие. */
  list: (sessionId: string) => SessionOutbox;
  /** Снять голову. `undefined` — очередь пуста; остановленную очередь это не проверяет. */
  takeHead: (sessionId: string) => SessionOutboxMessage | undefined;
  /** Вернуть снятое обратно в голову: запуск не удался, и порядок обязан уцелеть. */
  returnHead: (sessionId: string, message: SessionOutboxMessage) => void;
  /** Снять сообщение по идентификатору. `undefined` — такого в очереди нет. */
  remove: (sessionId: string, messageId: string) => SessionOutboxMessage | undefined;
  /** Остановить очередь названной причиной. Сообщения при этом целы. */
  halt: (sessionId: string, reason: string) => void;
  /** Снять остановку. Сливать очередь — дело вызывающего. */
  resume: (sessionId: string) => void;
  /** Забыть очередь целиком: сессию удалили, заархивировали или демон закрывается. */
  clear: (sessionId: string) => void;
};

type Queue = {
  messages: SessionOutboxMessage[];
  stopped?: { reason: string };
};

export type CreateMessageOutboxOptions = {
  /** Подменяется тестом: идентификаторы ждущих сообщений уезжают наружу в снимке и в дельте. */
  createMessageId?: () => string;
};

export function createMessageOutbox(options: CreateMessageOutboxOptions = {}): MessageOutbox {
  const queues = new Map<string, Queue>();

  let queued = 0;

  const createMessageId =
    options.createMessageId ??
    (() => {
      queued += 1;

      return `queued-${String(queued)}`;
    });

  const queueOf = (sessionId: string): Queue => {
    const existing = queues.get(sessionId);

    if (existing !== undefined) {
      return existing;
    }

    const created: Queue = { messages: [] };

    queues.set(sessionId, created);

    return created;
  };

  /** Пустая и не остановленная очередь не занимает памяти: сессий много, а очередь бывает у единиц. */
  const forgetIfEmpty = (sessionId: string, queue: Queue): void => {
    if (queue.messages.length === 0 && queue.stopped === undefined) {
      queues.delete(sessionId);
    }
  };

  return {
    enqueue: (sessionId, message) => {
      const queue = queueOf(sessionId);
      const placed: SessionOutboxMessage = {
        id: createMessageId(),
        text: message.text,
        ...(message.images === undefined ? {} : { images: message.images }),
        ...(message.model === undefined ? {} : { model: message.model }),
        ...(message.thinkingLevel === undefined ? {} : { thinkingLevel: message.thinkingLevel }),
      };

      queue.messages.push(placed);

      return placed;
    },
    list: (sessionId) => {
      const queue = queues.get(sessionId);

      if (queue === undefined) {
        return { messages: [] };
      }

      return {
        messages: [...queue.messages],
        ...(queue.stopped === undefined ? {} : { stopped: { ...queue.stopped } }),
      };
    },
    takeHead: (sessionId) => {
      const queue = queues.get(sessionId);
      const head = queue?.messages.shift();

      if (queue !== undefined) {
        forgetIfEmpty(sessionId, queue);
      }

      return head;
    },
    returnHead: (sessionId, message) => {
      queueOf(sessionId).messages.unshift(message);
    },
    remove: (sessionId, messageId) => {
      const queue = queues.get(sessionId);

      if (queue === undefined) {
        return undefined;
      }

      const at = queue.messages.findIndex((message) => message.id === messageId);

      if (at < 0) {
        return undefined;
      }

      const [removed] = queue.messages.splice(at, 1);

      forgetIfEmpty(sessionId, queue);

      return removed;
    },
    halt: (sessionId, reason) => {
      queueOf(sessionId).stopped = { reason };
    },
    resume: (sessionId) => {
      const queue = queues.get(sessionId);

      if (queue === undefined) {
        return;
      }

      delete queue.stopped;
      forgetIfEmpty(sessionId, queue);
    },
    clear: (sessionId) => {
      queues.delete(sessionId);
    },
  };
}
