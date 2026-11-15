import { createContext } from "react";

/** Lets any <Term> open the explainer for its glossary id without prop-drilling. */
export const ExplainContext = createContext(() => {});
