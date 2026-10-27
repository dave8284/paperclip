import { describe, expect, it } from "vitest";
import { conversationalAnswer, conversationalRuntimeResponse } from "./conversational-question";
import { questionSetToAskUserQuestionsPayload } from "@paperclipai/shared";

const payload = questionSetToAskUserQuestionsPayload({ schema: "paperclip.question_set.v1", questions: [{
  id: "meaning", prompt: "Do you mean the voice or the topic?", required: true, answerMode: "single_select",
  options: [{ id: "voice", label: "The voice you use" }, { id: "topic", label: "The topic we discuss" }], customAnswer: { enabled: true },
}] });
describe("conversational clarification answers", () => {
  it("maps an exact spoken option and preserves a natural free-text answer", () => {
    expect(conversationalAnswer(payload.questions[0], "The voice you use.")).toEqual({ questionId: "meaning", optionIds: ["voice"] });
    expect(conversationalAnswer(payload.questions[0], "I mean your voice; make it warmer.")).toEqual({ questionId: "meaning", optionIds: [], otherText: "I mean your voice; make it warmer." });
  });
  it("never guesses an answer to a closed choice", () => {
    const closed = { ...payload.questions[0], allowOther: false, options: payload.questions[0].options.filter(option => !option.freeText) };
    expect(() => conversationalAnswer(closed, "yes")).toThrow("Please say");
  });
  it("uses the canonical runtime response for custom and exact answers", () => {
    expect(conversationalRuntimeResponse(payload, [conversationalAnswer(payload.questions[0], "voice")]).answers).toEqual({ meaning: { selectedOptionIds: ["voice"] } });
    expect(conversationalRuntimeResponse(payload, [conversationalAnswer(payload.questions[0], "A softer voice")]).answers).toEqual({ meaning: { selectedOptionIds: [], customText: "A softer voice" } });
  });
});
