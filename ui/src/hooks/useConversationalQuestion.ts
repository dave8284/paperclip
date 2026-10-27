import { useRef, useState } from "react";
import type { AskUserQuestionsAnswer, AskUserQuestionsPayload } from "@paperclipai/shared";
import { conversationalAnswer, conversationalPrompt } from "@/lib/conversational-question";

export interface ConversationalQuestion {
  key: string;
  payload: AskUserQuestionsPayload;
  submit: (answers: AskUserQuestionsAnswer[]) => void | Promise<void>;
}

/** Friday's presentation adapter. The native interaction/runtime still owns
 * validation, resolution, audit and delivery to the waiting agent. */
export function useConversationalQuestion(scope: string, request: ConversationalQuestion | null) {
  const [, refresh] = useState(0);
  const state = useRef<{ key: string; answers: AskUserQuestionsAnswer[]; completed: boolean; busy: boolean; error: string; attempt: number }>({ key: "", answers: [], completed: false, busy: false, error: "", attempt: 0 });
  const key = request ? `friday:question:${scope}:${request.key}` : "";
  if (state.current.key !== key) {
    let answers: AskUserQuestionsAnswer[] = [];
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) ?? "null");
      if (Array.isArray(saved) && request && saved.length < request.payload.questions.length && saved.every((answer, i) =>
        answer.questionId === request.payload.questions[i].id && Array.isArray(answer.optionIds) && answer.optionIds.every((id: unknown) => typeof id === "string") && (answer.otherText == null || typeof answer.otherText === "string"))) answers = saved;
    } catch { /* Browser draft storage is optional. */ }
    state.current = { key, answers, completed: false, busy: false, error: "", attempt: 0 };
  }
  const current = state.current;
  const prompt = request && !current.completed && !current.busy
    ? { id: `${key}:${current.answers.length}:${current.attempt}`, body: [current.error, conversationalPrompt(request.payload, current.answers.length)].filter(Boolean).join(" ") } : undefined;
  const submit = async (text: string) => {
    if (!request || current.completed) return false;
    if (current.busy) throw new Error("Your answer is still being sent. Please wait a moment.");
    const question = request.payload.questions[current.answers.length];
    if (!question) return false;
    try {
      current.error = "";
      const answers = [...current.answers, conversationalAnswer(question, text)];
      if (answers.length < request.payload.questions.length) {
        current.answers = answers;
        try { sessionStorage.setItem(key, JSON.stringify(answers)); } catch { /* Optional draft. */ }
      } else {
        current.busy = true; refresh(n => n + 1);
        try {
          await request.submit(answers);
          current.completed = true;
          try { sessionStorage.removeItem(key); } catch { /* Optional draft. */ }
        } finally { current.busy = false; if (state.current === current) refresh(n => n + 1); }
      }
      if (state.current === current) refresh(n => n + 1);
      return true;
    } catch (error) {
      current.error = error instanceof Error ? error.message : "I couldn’t save your answer. Please try again.";
      current.attempt++;
      if (state.current === current) refresh(n => n + 1);
      throw error;
    }
  };
  return { prompt, submit, active: !!request && !current.completed, error: current.error };
}
