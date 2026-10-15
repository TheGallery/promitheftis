/** What the game needs to know of a key event. */
export interface KeyEventLike {
  key: string;
  code: string;
  shiftKey?: boolean;
}

/**
 * The key the game sees for a key event. On a keyboard whose letters are not Latin the key of the event is a letter the
 * game does not use, so the letter of the physical key (its code) stands in: H, S, B, R, U, A, P and C work on every
 * layout. Every other key, and every key of a Latin layout, is the key of the event.
 */
export function gameKey({ key, code, shiftKey = false }: KeyEventLike): string {
  const letter = /^Key([A-Z])$/.exec(code)?.[1];
  if (!letter || [...key].length !== 1 || key.charCodeAt(0) < 128) return key;
  return shiftKey ? letter : letter.toLowerCase();
}
