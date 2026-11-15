import type { ChatTurn } from "./types";

/**
 * Privacy-first context adapter. The first release only passes the current
 * request's bounded conversation. It deliberately does not persist content.
 * A future persistent memory implementation must be opt-in, user-scoped,
 * exportable and deletable before it is enabled.
 */
export function buildWorkingContext(messages: ChatTurn[]): ChatTurn[] {
  return messages.map(({ role, content }) => ({ role, content }));
}
