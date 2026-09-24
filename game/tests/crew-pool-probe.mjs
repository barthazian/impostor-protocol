/**
 * Crew artwork pool probe — RECORD canonical Generations artwork from Robinhood
 * mainnet, then VERIFY the recorded copy later against the live chain.
 *
 *   node games/impostor-protocol/tests/crew-pool-probe.mjs --record --out ~/ip-art-draft/crew-pool.mjs
 *   node games/impostor-protocol/tests/crew-pool-probe.mjs --verify
 *
 * `--record` reads `familyOf` / `seedOf` / `frames` for ids 1..16 exactly the way
 * the SDK's `createGenerationSpriteReader()` reads them (same ABI, same registry,
 * same argument shapes, same decoder), and writes `scripts/crew-pool.mjs` — the
 * recorded pool that `scripts/browser-fixture.mjs` serves to the automated
 * browser tests, because the fixture's own artwork mock used to answer for token
 * 7730 only and aborted every other read.
 *
 * `--verify` re-reads the same ids LIVE and asserts every recorded word is still
 * byte-identical, so a stale, trimmed or hand-edited pool cannot pass silently.
 * It also rejects a pool whose ids are not mutually distinct artwork.
 *
 * This is a read-only probe: it signs nothing, owns nothing and writes no chain
 * state. The game itself never runs it — it is evidence, not a runtime path.
 */
import { writeFile } from "node:fs/promises";
import { createPublicClient, http, parseAbi } from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;
const REGISTRY = "0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D";
const POOL_MODULE = new URL("../../../scripts/crew-pool.mjs", import.meta.url);

const FAMILIES_REGISTRY_ABI = parseAbi([
  "function familyOf(uint256 tokenId) pure returns (uint8)",
  "function seedOf(uint256 tokenId) pure returns (uint32)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
]);

/** The ids the game draws crew from; keep in step with CREW_TOKEN_POOL. */
const IDS = Array.from({ length: 16 }, (_, index) => BigInt(index + 1));

const client = createPublicClient({ transport: http(RPC, { retryCount: 2, timeout: 15_000 }) });

/** FNV-1a over the 64 words, the same digest the game reports. */
function framesDigest(frames) {
  let text = "";
  for (const frame of frames) text += frame.toString(16);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) hash = Math.imul(hash ^ text.charCodeAt(index), 0x01000193);
  return (hash >>> 0).toString(16).padStart(8, "0");
}

async function readToken(id) {
  const started = performance.now();
  const [familyId, seed] = await Promise.all([
    client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [id] }),
    client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [id] }),
  ]);
  const frames = await client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [familyId, seed] });
  return { id, familyId, seed, frames: [...frames], readMs: Math.round(performance.now() - started) };
}

/** Four at a time: polite to the public RPC, and still a parallel read. */
async function readAll(ids) {
  const out = [];
  for (let index = 0; index < ids.length; index += 4) {
    out.push(...await Promise.all(ids.slice(index, index + 4).map(readToken)));
  }
  return out;
}

function quoted(frames) {
  const lines = [];
  for (let index = 0; index < frames.length; index += 4) {
    lines.push(`      ${frames.slice(index, index + 4).map(frame => `0x${frame.toString(16)}n`).join(", ")},`);
  }
  return lines.join("\n");
}

const mode = process.argv.includes("--verify") ? "verify" : "record";
const outIndex = process.argv.indexOf("--out");
const outPath = outIndex === -1 ? null : process.argv[outIndex + 1];

console.log(`chain ${await client.getChainId()} (expected ${CHAIN_ID}) · registry ${REGISTRY}`);
console.log(`mode ${mode} · ids ${IDS.length}`);
if (mode === "record") {
  const block = await client.getBlockNumber().catch(() => null);
  const at = new Date().toISOString();
  const records = await readAll(IDS);
  const digests = new Map();
  for (const record of records) {
    const digest = framesDigest(record.frames);
    if (digests.has(digest)) throw new Error(`Token ${record.id} duplicates token ${digests.get(digest)}'s artwork — the pool must be distinct.`);
    digests.set(digest, record.id);
    if (record.frames.length !== 64) throw new Error(`Token ${record.id} returned ${record.frames.length} frames, not 64.`);
  }
  console.log(`recorded ${records.length} tokens · ${[...digests.values()].length} distinct artworks`);
  for (const record of records) {
    console.log(`  id=${record.id} family=${record.familyId} seed=${record.seed} ${record.readMs}ms digest=${digests.get(framesDigest(record.frames)) === undefined ? "" : framesDigest(record.frames)}`);
  }
  const body = records.map(record => `  ${JSON.stringify(String(record.id))}: Object.freeze({\n`
    + `    familyId: ${record.familyId}, seed: ${record.seed},\n`
    + `    frames: Object.freeze([\n${quoted(record.frames)}\n    ]),\n  }),`).join("\n");
  const module = `/**\n * Recorded canonical Generations artwork — NOT hand-written, NOT generated art.\n *\n * Read live from Robinhood mainnet (chain ${CHAIN_ID}), registry\n * ${REGISTRY},\n * at ${at}${block === null ? "" : ` (block ${block})`}, with the same\n * \`familyOf\` / \`seedOf\` / \`frames\` calls the SDK's createGenerationSpriteReader()\n * makes for a real Friend. These are the bytes the chain returned, verbatim.\n *\n * Re-record with:\n *   node games/impostor-protocol/tests/crew-pool-probe.mjs --record --out scripts/crew-pool.mjs\n * Re-verify against the live chain with:\n *   node games/impostor-protocol/tests/crew-pool-probe.mjs --verify\n *\n * Consumed by scripts/browser-fixture.mjs, which serves exactly this artwork to\n * the automated browser tests and still refuses any id outside this pool.\n */\nexport const CREW_POOL_RECORDED_AT = ${JSON.stringify(at)};\nexport const CREW_POOL_RECORDED_BLOCK = ${block === null ? "null" : String(block)};\n\nexport const CREW_POOL = Object.freeze({\n${body}\n});\n`;
  if (outPath) {
    await writeFile(outPath, module);
    console.log(`wrote ${outPath} (${module.length} bytes)`);
  } else process.stdout.write(module);
} else {
  const { CREW_POOL, CREW_POOL_RECORDED_AT } = await import(POOL_MODULE.href);
  const recorded = new Map(Object.entries(CREW_POOL).map(([id, value]) => [id, value]));
  if (recorded.size === 0) throw new Error("The recorded pool is empty.");
  console.log(`recorded pool: ${recorded.size} ids, recorded at ${CREW_POOL_RECORDED_AT}`);
  const live = await readAll(IDS);
  const problems = [];
  const digests = new Map();
  for (const record of live) {
    const value = recorded.get(String(record.id));
    if (!value) { problems.push(`id ${record.id} is live and decodable but missing from the recorded pool`); continue; }
    if (value.familyId !== record.familyId) problems.push(`id ${record.id}: familyId recorded ${value.familyId}, chain says ${record.familyId}`);
    if (value.seed !== record.seed) problems.push(`id ${record.id}: seed recorded ${value.seed}, chain says ${record.seed}`);
    if (value.frames.length !== 64) problems.push(`id ${record.id}: recorded ${value.frames.length} frames, not 64`);
    for (let index = 0; index < Math.min(value.frames.length, record.frames.length); index++) {
      if (value.frames[index] !== record.frames[index]) { problems.push(`id ${record.id}: frame ${index} recorded 0x${value.frames[index].toString(16)}, chain 0x${record.frames[index].toString(16)}`); break; }
    }
    const digest = framesDigest(record.frames);
    if (digests.has(digest)) problems.push(`id ${record.id}: artwork duplicates id ${digests.get(digest)}`);
    digests.set(digest, record.id);
    console.log(`  id=${record.id} family=${record.familyId} seed=${record.seed} ${record.readMs}ms digest=${digest} ${problems.length ? "MISMATCH" : "match"}`);
  }
  if (problems.length) { for (const line of problems) console.error(`FAIL ${line}`); process.exitCode = 1; }
  else console.log(`verified: every recorded word still matches the live chain (${live.length} tokens, ${digests.size} distinct artworks)`);
}
