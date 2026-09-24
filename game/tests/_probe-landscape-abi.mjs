/** throwaway: is there readable landscape/tile data on the two manifest-only addresses? */
import { createPublicClient, http, toFunctionSelector, encodeAbiParameters, decodeAbiParameters } from "viem";

const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
const ADDRESSES = {
  seededLandscape: "0x450E3a18cb4d0264C61ff6468FC988FD9F78967D",
  worldData: "0xB78F68992d4c61c491EDCCa7890a05e7DBeb3970",
};

const CANDIDATES = [
  "seed()", "worldSeed()", "seedOf(uint256)", "landscapeSeed(uint256)", "landscape(uint256)",
  "tile(uint256,uint256)", "tiles(uint256,uint256)", "chunk(uint256,uint256)", "at(int256,int256)",
  "getTile(uint256,uint256)", "terrain(uint256,uint256)", "render(uint256,uint256)", "palette(uint256)",
  "bitmap(uint256,uint256)", "chunkOf(uint256,uint256)", "seededLandscape(uint256)", "landscapeOf(uint256)",
  "name()", "symbol()", "totalSupply()",
];

for (const [name, address] of Object.entries(ADDRESSES)) {
  console.log(`--- ${name} ${address} ---`);
  for (const signature of CANDIDATES) {
    const selector = toFunctionSelector(signature);
    let data = selector;
    const args = signature.match(/\(([^)]*)\)/)?.[1];
    if (args) {
      const types = args.split(",").filter(Boolean).map(t => t.trim());
      data = selector + encodeAbiParameters(types.map(t => ({ type: t })), types.map(() => 1n)).slice(2);
    }
    try {
      const result = await client.call({ to: address, data });
      const body = result.data ?? "0x";
      console.log(`  ${signature.padEnd(28)} ${selector} -> OK ${body.slice(0, 74)}${body.length > 74 ? `…(${(body.length - 2) / 2} bytes)` : ""}`);
    } catch (error) {
      console.log(`  ${signature.padEnd(28)} ${selector} -> ${String(error.shortMessage ?? error.message).split("\n")[0].slice(0, 60)}`);
    }
  }
}
