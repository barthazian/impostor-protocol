/**
 * Seeded + crypto randomness helpers.
 *
 * Room codes hash to a deterministic stream so the same code reproduces the
 * same station, roles, bot personalities and sabotage schedule. Browser
 * entropy is used only where a genuinely fresh roll is wanted (in-match
 * presentation RNG); it never decides an RF outcome — the SDK's action client
 * owns that.
 */

/** xmur3 string hash → 32-bit seed. */
export function hashSeed(text: string): number {
  let hash = 1779033703 ^ text.length;
  for (let index = 0; index < text.length; index++) {
    hash = Math.imul(hash ^ text.charCodeAt(index), 3432918353);
    hash = (hash << 13) | (hash >>> 19);
  }
  hash = Math.imul(hash ^ (hash >>> 16), 2246822507);
  hash = Math.imul(hash ^ (hash >>> 13), 3266489909);
  return (hash ^= hash >>> 16) >>> 0;
}

/** mulberry32: small, fast, deterministic. */
export function createRng(seed: number) {
  let state = seed >>> 0 || 0x9e3779b9;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
  return Object.freeze({
    next,
    /** Integer in [0, bound). */
    int: (bound: number) => Math.floor(next() * bound),
    pick: <T,>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
    chance: (probability: number) => next() < probability,
    range: (min: number, max: number) => min + next() * (max - min),
  });
}
export type Rng = ReturnType<typeof createRng>;

/** Fresh browser entropy in [0, 10000) with rejection sampling; preview use only. */
export function cryptoRoll(): number {
  const word = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(word); } while (word[0] >= 4294960000);
  return word[0] % 10000;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
export function createRoomCode(random: () => number = Math.random): string {
  let code = "";
  for (let index = 0; index < 4; index++) code += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length)];
  return code;
}

export function normalizeRoomCode(input: string): string {
  return input.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4) || "SOS0";
}
