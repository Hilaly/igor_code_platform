/**
 * Правила черновика конфига без отрисовки. Главное здесь — «есть ли что терять»: по нему форма
 * решает, принять ли снимок, и он же отличает собственную запись, доехавшую обратно, от чужой
 * правки файла (docs/data-directory.md).
 */

import { defaultConfig } from "@sovereign/protocol";
import { describe, expect, it } from "vitest";

import { draftOf, editDraft, hasUnsavedEdits, readDraft, sameConfig } from "./config-draft.ts";

describe("the config draft", () => {
  it("reads back exactly what the snapshot said", () => {
    const reading = readDraft(draftOf(defaultConfig));

    expect(reading).toEqual({ kind: "read", config: defaultConfig });
  });

  it("reads an edited number", () => {
    const draft = editDraft(draftOf(defaultConfig), "publicRouteRequestsPerMinute", "3");
    const reading = readDraft(draft);

    expect(reading.kind === "read" && reading.config.publicRouteRequestsPerMinute).toBe(3);
  });

  it("reads the fraction of the compaction threshold", () => {
    const draft = editDraft(draftOf(defaultConfig), "compactionThreshold", "0.75");
    const reading = readDraft(draft);

    expect(reading.kind === "read" && reading.config.compactionThreshold).toBe(0.75);
  });

  it("refuses a field that is not a number", () => {
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "полтора");

    expect(readDraft(draft)).toEqual({ kind: "unreadable", unreadable: ["maxConcurrentTurns"] });
  });

  it("refuses an emptied field instead of reading it as zero", () => {
    // `Number("")` — это ноль, и без явной проверки очищенное поле уехало бы к демону нулём.
    const draft = editDraft(draftOf(defaultConfig), "hookTimeoutMilliseconds", "  ");

    expect(readDraft(draft)).toEqual({
      kind: "unreadable",
      unreadable: ["hookTimeoutMilliseconds"],
    });
  });

  it("refuses a log level that is not one", () => {
    const draft = editDraft(draftOf(defaultConfig), "logLevel", "loud");

    expect(readDraft(draft)).toEqual({ kind: "unreadable", unreadable: ["logLevel"] });
  });

  it("does not check the rules the daemon checks", () => {
    // Ноль обращений разом — негодное значение, но правило живёт в протоколе, и второй его
    // экземпляр здесь разошёлся бы с первым молча. Отказ придёт от демона с точной причиной.
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "0");

    expect(readDraft(draft).kind).toBe("read");
  });

  it("has nothing to lose while nothing is edited", () => {
    expect(hasUnsavedEdits(draftOf(defaultConfig), defaultConfig)).toBe(false);
  });

  it("has something to lose once a field is edited", () => {
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "8");

    expect(hasUnsavedEdits(draft, defaultConfig)).toBe(true);
  });

  it("has nothing to lose when the snapshot caught up with the edit", () => {
    // Собственная запись доехала обратно: значения совпали, и снимок можно принимать молча.
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "8");
    const written = { ...defaultConfig, maxConcurrentTurns: 8 };

    expect(hasUnsavedEdits(draft, written)).toBe(false);
  });

  it("has something to lose when the file changed into something else", () => {
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "8");
    const fromDisk = { ...defaultConfig, maxConcurrentTurns: 2 };

    expect(hasUnsavedEdits(draft, fromDisk)).toBe(true);
    expect(sameConfig(draft.base, fromDisk)).toBe(false);
  });

  it("has something to lose while a field is unreadable", () => {
    const draft = editDraft(draftOf(defaultConfig), "maxConcurrentTurns", "во");

    expect(hasUnsavedEdits(draft, defaultConfig)).toBe(true);
  });
});
