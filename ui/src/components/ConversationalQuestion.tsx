import { createContext, useContext } from "react";
import type { AskUserQuestionsPayload } from "@paperclipai/shared";
import { MarkdownBody } from "./MarkdownBody";

export const ConversationalQuestionsContext = createContext(false);
export const useConversationalQuestions = () => useContext(ConversationalQuestionsContext);

/** A clarification reads like a message; it never opens a questionnaire. */
export function ConversationalQuestionMessage({ payload }: { payload: AskUserQuestionsPayload }) {
  return <div className="space-y-2 text-sm" data-testid="conversational-question">
    {payload.questions.map(question => <MarkdownBody key={question.id}>{question.prompt}</MarkdownBody>)}
  </div>;
}
