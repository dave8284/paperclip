import { expect, it } from "vitest";
import { FridaySpeechBuffer, spokenReply } from "./friday-speech-buffer";

it("releases complete sentences before final persistence and retains the unfinished tail", async () => {
  const buffer = new FridaySpeechBuffer();
  buffer.update("Your microphone works. The next", false);
  expect(await buffer.next()).toBe("Your microphone works.");
  let delivered = false;
  const next = Promise.resolve(buffer.next()).then(value => { delivered = true; return value; });
  await Promise.resolve(); expect(delivered).toBe(false);
  buffer.update("Your microphone works. The next step is ready.", true);
  expect(await next).toBe("The next step is ready.");
  expect(await buffer.next()).toBeNull();
});

it("never queues an incomplete number or an unfinished code/link body", async () => {
  const buffer = new FridaySpeechBuffer();
  buffer.update("The total is 123.", false);
  const first = buffer.next();
  buffer.update("The total is 123.45. See [private", false);
  expect(await first).toBe("The total is 123.45.");
  buffer.update("The total is 123.45. See [private notes](https://example.invalid). ```js\nsecret()", false);
  expect(await buffer.next()).toBe("See private notes.");
  expect(spokenReply("Ready. ```js\nsecret()", false)).toBe("Ready.");
  buffer.cancel(); expect(await buffer.next()).toBeNull();
});

it("cancels queued and waiting text when a spoken prefix is rewritten", async () => {
  const buffer = new FridaySpeechBuffer();
  buffer.update("The total is ten. Next", false);
  expect(await buffer.next()).toBe("The total is ten.");
  const next = buffer.next();
  buffer.update("The total is twelve. Next", false);
  expect(buffer.cancelled).toBe(true); expect(await next).toBeNull();
  buffer.update("The total is twelve. Complete.", true);
  expect(await buffer.next()).toBeNull();
});

it.each([120, 220])("does not turn a decimal at the %s-character chunk boundary into a sentence", async limit => {
  const buffer = new FridaySpeechBuffer();
  const first = limit === 220 ? "Ready. " : "";
  const prefix = "The amount " + "x".repeat(limit - 16) + " ";
  const sentence = `${prefix}123.45 units.`;
  expect(sentence.indexOf(".")).toBe(limit - 1);
  buffer.update(first + sentence, true);
  const chunks: string[] = [];
  for (let chunk = await buffer.next(); chunk; chunk = await buffer.next()) chunks.push(chunk);
  expect(chunks.join(" ")).toBe((first + sentence).trim());
  expect(chunks.some(chunk => /123\.$/.test(chunk))).toBe(false);
  expect(chunks.at(-1)).toContain("123.45");
});
