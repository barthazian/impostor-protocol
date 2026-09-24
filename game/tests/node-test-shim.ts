/**
 * Ambient declarations for the two Node builtins the simulation tests import.
 *
 * The friendsdk repo does not ship @types/node and the game tsconfig only pulls
 * in @types/react, so `tsc -p games/impostor-protocol/tsconfig.json` would
 * otherwise fail on `import { test } from "node:test"`. Only the handful of
 * surface the tests use is declared; runtime behaviour is Node's.
 */
declare module "node:test" {
  type TestBody = () => void | Promise<void>;
  function test(name: string, body: TestBody): Promise<void>;
  export default test;
  export { test };
}

declare module "node:assert/strict" {
  interface AssertStrict {
    (value: unknown, message?: string): asserts value;
    ok(value: unknown, message?: string): asserts value;
    equal(actual: unknown, expected: unknown, message?: string): void;
    notEqual(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
    notDeepEqual(actual: unknown, expected: unknown, message?: string): void;
    strictEqual(actual: unknown, expected: unknown, message?: string): void;
    notStrictEqual(actual: unknown, expected: unknown, message?: string): void;
    throws(block: () => unknown, message?: string): void;
    fail(message?: string): never;
  }
  const assert: AssertStrict;
  export default assert;
  export { assert };
}
