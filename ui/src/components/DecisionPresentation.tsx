import { createContext } from "react";

/** Presentation only. Native resolvers continue to own authorization and effects. */
export const DecisionPresentation = createContext<"native" | "approval">("native");
