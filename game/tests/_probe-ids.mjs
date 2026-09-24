/**
 * throwaway probe: which Generations token ids return a decodable canonical
 * sprite frame? Reads the registry directly, the same way
 * createGenerationSpriteReader() does, and records latency.
 */
import { createPublicClient, http, parseAbi } from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const CHAIN_ID = 4663;
const REGISTRY = "0x246E3E9730A7Eade94c79be0Fd78d210f89AEb8D";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";

const FAMILIES_REGISTRY_ABI = parseAbi([
  "function familyOf(uint256 tokenId) pure returns (uint8)",
  "function seedOf(uint256 tokenId) pure returns (uint32)",
  "function familyName(uint8 id) pure returns (string)",
  "function frames(uint8 id, uint32 seed) view returns (uint256[64])",
]);

const client = createPublicClient({ transport: http(RPC, { retryCount: 1, timeout: 12_000 }) });
console.log("chainId:", await client.getChainId(), "expected", CHAIN_ID);

try {
  const abi = parseAbi(["function totalSupply() view returns (uint256)"]);
  console.log("totalSupply:", String(await client.readContract({ address: GENERATIONS, abi, functionName: "totalSupply" })));
} catch (e) { console.log("totalSupply REVERT:", String(e.shortMessage ?? e.message).split("\n")[0]); }

function checksum(rows) {
  let h = 0x811c9dc5;
  for (const row of rows) for (const ch of row) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193);
  return (h >>> 0).toString(16).padStart(8, "0");
}

const ids = [];
for (let i = 1; i <= 64; i++) ids.push(BigInt(i));
for (const i of [100, 128, 256, 512, 1000, 2048, 4096, 5000, 8192, 10000, 12345, 20000, 25000, 32768, 40000, 50000, 65535, 100000]) ids.push(BigInt(i));

const ok = [], bad = [];
for (const id of ids) {
  const started = performance.now();
  try {
    const [familyId, seed] = await Promise.all([
      client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "familyOf", args: [id] }),
      client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "seedOf", args: [id] }),
    ]);
    const frames = await client.readContract({ address: REGISTRY, abi: FAMILIES_REGISTRY_ABI, functionName: "frames", args: [familyId, seed] });
    const elapsed = Math.round(performance.now() - started);
    // decode the same way decodeSpriteBitmap does: bit 0 = top-left
    const allZero = frames.every(f => f === 0n);
    const firstRows = Array.from({ length: 16 }, (_, y) =>
      Array.from({ length: 16 }, (_, x) => (frames[0] & (1n << BigInt(y * 16 + x))) ? "#" : ".").join("")).join("/");
    ok.push({ id: id.toString(), familyId, seed, elapsed, allZero, checksum: checksum(firstRows.split("/")), rows: firstRows });
  } catch (error) {
    bad.push({ id: id.toString(), reason: String(error.shortMessage ?? error.message ?? error).split("\n")[0].slice(0, 80) });
  }
}
console.log(`decodable: ${ok.length}   rejected: ${bad.length}`);
for (const row of ok) {
  console.log(`  id=${row.id} family=${row.familyId} seed=${row.seed} ${row.elapsed}ms zero=${row.allZero} ck=${row.checksum}`);
}
console.log("frame0 rows of the first 3:");
for (const row of ok.slice(0, 3)) console.log(`--- id ${row.id} ---\n${row.rows.split("/").join("\n")}`);
console.log("rejected sample:");
for (const row of bad.slice(0, 8)) console.log(`  id=${row.id} -> ${row.reason}`);
