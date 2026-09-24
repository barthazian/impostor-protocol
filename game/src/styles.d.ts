/**
 * Game-local ambient declarations.
 *
 * The frozen tsconfig for this game has no `allowArbitraryExtensions` and no
 * CSS declaration, so a bare `import "./ui.css";` is flagged by TS 6 (TS2882).
 * This mirrors `examples/styles.d.ts` in the SDK.
 */
declare module "*.css";
