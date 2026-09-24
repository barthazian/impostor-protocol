/**
 * Read a wallet's Friend generations straight from Robinhood mainnet and say
 * exactly which tokens are hardwired (generation >= 1) and which are not.
 * Uses the same rule the SDK gates on (identity.ts: hardwired = generation >= 1).
 *
 *   node games/impostor-protocol/tests/wallet-generations.mjs 0xYourWallet
 */
import { createPublicClient, http, parseAbi, getAddress } from "viem";

const RPC = "https://rpc.mainnet.chain.robinhood.com";
const GENERATIONS = "0x14C49e6118F46525dE9ab41a51cBAA3c6EBF181D";
const CHAIN_ID = 4663;

const input = process.argv[2];
if (!input) throw new Error("usage: node wallet-generations.mjs 0xWalletAddress");
const account = getAddress(input);

const client = createPublicClient({ transport: http(RPC) });
const chainId = await client.getChainId();
if (chainId !== CHAIN_ID) throw new Error(`RPC is on chain ${chainId}, expected ${CHAIN_ID}`);

const abi = parseAbi([
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function generation(uint256 tokenId) view returns (uint8)",
]);
const transferEvent = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
])[0];

const blockNumber = await client.getBlockNumber();
const received = await client.getLogs({
  address: GENERATIONS, event: transferEvent, args: { to: account },
  fromBlock: 0n, toBlock: blockNumber, strict: true,
});

const candidates = [...new Set(received.map(log => log.args.tokenId))].sort((a, b) => (a < b ? -1 : 1));
const short = value => `${value.slice(0, 6)}…${value.slice(-4)}`;
const rows = [];
let unreadable = 0;
for (const id of candidates) {
  let owner;
  let generation;
  try {
    [owner, generation] = await Promise.all([
      client.readContract({ address: GENERATIONS, abi, functionName: "ownerOf", args: [id] }),
      client.readContract({ address: GENERATIONS, abi, functionName: "generation", args: [id] }),
    ]);
  } catch (error) {
    // `ownerOf` reverts for burned or nonexistent ids, and historical Transfer
    // logs routinely name ids that no longer resolve. One revert must never abort
    // the whole wallet read.
    unreadable += 1;
    const reason = String(error.shortMessage ?? error.message ?? error).split("\n")[0].slice(0, 70);
    console.log(`  Friend #${id}  unreadable — ${reason}`);
    continue;
  }
  if (getAddress(owner) !== account) continue;
  rows.push({ tokenId: id.toString(), generation, hardwired: generation >= 1, currentOwner: short(owner) });
}

rows.sort((a, b) => a.generation - b.generation);
console.log(`wallet ${short(account)} · block ${blockNumber}`);
console.log(`tokens currently owned from the Generations contract: ${rows.length}`);
for (const row of rows) {
  console.log(`  Friend #${row.tokenId}  generation=${row.generation}  ${row.hardwired ? "HARDWIRED (playable)" : "not hardwired — hidden by the SDK gate"}`);
}
const eligible = rows.filter(row => row.hardwired).length;
console.log(`=> the owner-selection picker should list ${eligible} Friend(s) and report ${rows.length - eligible} hidden as "not hardwired (generation 0)"`);
