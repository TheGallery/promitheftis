/** Somewhere small to keep text between visits. Neither call ever throws: when nothing can be kept, nothing is. */
export interface Store {
  /** The text kept under `key`, or null if there is none or it cannot be read. */
  read(key: string): string | null;
  /** Keeps `value` under `key`; does nothing if it cannot be kept. */
  write(key: string, value: string): void;
}

/**
 * The browser's local storage. It can be missing or refuse to work (a private window, blocked site data,
 * no room left), and then the game plays on without saving.
 */
export function browserStore(): Store {
  return {
    read(key) {
      try {
        return globalThis.localStorage.getItem(key);
      } catch {
        return null;
      }
    },
    write(key, value) {
      try {
        globalThis.localStorage.setItem(key, value);
      } catch {
        // Nothing to do: the run is not saved this time.
      }
    },
  };
}

/** A store that lives only as long as the page, for tests and for a game with nowhere to save. */
export function memoryStore(initial: Record<string, string> = {}): Store & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    read: (key) => data.get(key) ?? null,
    write: (key, value) => void data.set(key, value),
  };
}
