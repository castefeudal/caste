import { describe, expect, it } from "vitest";
import { demoProvider, extractObligation, scoreExtraction } from "../src/extract.js";

describe("demo extractor", () => {
  it("extracts urgency to critical priority", async () => {
    const e = await demoProvider.extract("Срочно оплатить штраф ГИБДД");
    expect(e.priority).toBe("critical");
  });

  it("extracts due date from 'через N дней'", async () => {
    const e = await demoProvider.extract("Позвонить бабушке через 3 дня");
    expect(e.dueAt).not.toBeNull();
    const days = (new Date(e.dueAt as string).getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(2);
    expect(days).toBeLessThan(4);
  });

  it("tomorrow and today map to dates", async () => {
    expect((await demoProvider.extract("Купить хлеб завтра")).dueAt).not.toBeNull();
    expect((await demoProvider.extract("Забрать посылку сегодня")).dueAt).not.toBeNull();
  });

  it("long sentences without signals score below auto threshold", async () => {
    const e = await extractObligation("какой-то текст");
    expect(e.action).toBe("do_not_create");
  });

  it("insurance/bills get high priority", async () => {
    expect((await demoProvider.extract("Продлить страховку ОСАГО")).priority).toBe("high");
  });

  it("someday items are low priority", async () => {
    expect((await demoProvider.extract("Прочитать книгу (не горит)")).priority).toBe("low");
  });

  it("scoreExtraction routes medical to review regardless of score", () => {
    expect(scoreExtraction({ confidence: 0.97 }, "medical").action).toBe("needs_review");
  });

  it("auto_create only above 0.95 with low risk", async () => {
    const rich = await extractObligation("Срочно оплатить счёт за электричество до завтра");
    expect(rich.priority).toBe("critical");
    expect(rich.dueAt).not.toBeNull();
  });

  it("title never exceeds 280 chars", async () => {
    const e = await demoProvider.extract("х".repeat(500));
    expect(e.title.length).toBeLessThanOrEqual(280);
  });
});
