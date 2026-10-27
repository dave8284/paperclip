import type { AskUserQuestionsAnswer, AskUserQuestionsPayload, AskUserQuestionsQuestion } from "@paperclipai/shared";

const normalize = (text: string) => text.toLocaleLowerCase().replace(/[.,!?]+$/g, "").replace(/\s+/g, " ").trim();

/** Preserve the user's words. Only exact labels/IDs select a closed option;
 * everything else uses the question's explicitly permitted free-text answer. */
export function conversationalAnswer(question: AskUserQuestionsQuestion, text: string): AskUserQuestionsAnswer {
  const body = text.trim();
  if (!body) throw new Error("I didn’t catch your answer. Could you say it again?");
  const options = question.options.filter(option => !option.freeText);
  const exact = options.find(option => normalize(option.label) === normalize(body) || normalize(option.id) === normalize(body));
  if (exact) return { questionId: question.id, optionIds: [exact.id] };
  if (question.selectionMode === "multi") {
    const parts = body.split(/,|\band\b/i).map(normalize).filter(Boolean);
    const selected = parts.map(part => options.find(option => normalize(option.label) === part || normalize(option.id) === part));
    if (selected.length && selected.every(Boolean)) return { questionId: question.id, optionIds: [...new Set(selected.map(option => option!.id))] };
  }
  if (question.allowOther !== false || question.options.some(option => option.freeText)) {
    return { questionId: question.id, optionIds: [], otherText: body };
  }
  throw new Error(`Please say ${options.map(option => option.label).join(" or ")}.`);
}

export function conversationalPrompt(payload: AskUserQuestionsPayload, index: number) {
  const question = payload.questions[index];
  if (!question) return "";
  const choices = question.allowOther === false && !question.options.some(option => option.freeText)
    ? ` You can say ${question.options.map(option => option.label).join(" or ")}.` : "";
  return `${question.prompt}${choices}`;
}

/** Same canonical response accepted by the runtime question form. */
export function conversationalRuntimeResponse(payload: AskUserQuestionsPayload, answers: AskUserQuestionsAnswer[]) {
  return { schema: "paperclip.question_response.v1" as const, answers: Object.fromEntries(answers.map(answer => {
    const question = payload.questionSet?.questions.find(item => item.id === answer.questionId);
    return [answer.questionId, question?.answerMode === "text"
      ? { text: answer.otherText ?? "" }
      : { selectedOptionIds: answer.optionIds, ...(answer.otherText ? { customText: answer.otherText } : {}) }];
  })) };
}
