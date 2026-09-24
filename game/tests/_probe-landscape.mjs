/** throwaway: what does the SDK actually give us for world/landscape art? */
import { WORLD_PRESETS, getWorldPreset, renderWorldLayers, renderProp, PROP_TYPES, CANVAS, PROP_CANVAS } from "@rarefriends/friendsdk/world";
import { createPublicClient, http } from "viem";

console.log("PROP_TYPES:", PROP_TYPES.join(", "));
console.log("CANVAS:", JSON.stringify(CANVAS), "PROP_CANVAS:", JSON.stringify(PROP_CANVAS));
console.log("WORLD_PRESETS:", WORLD_PRESETS.length, WORLD_PRESETS.map(w => w.id).join(", "));

const world = getWorldPreset(WORLD_PRESETS[0].id);
const layers = renderWorldLayers(world, { signals: true });
console.log("renderWorldLayers ->", Object.keys(layers).join(","), "width", layers.width, "height", layers.height);
console.log("  terrainSvg bytes:", layers.terrainSvg.length, "starts:", layers.terrainSvg.slice(0, 140));
console.log("  object layers:", layers.objects.length, "kinds:", [...new Set(layers.objects.map(o => o.kind))].join(","));
const props = layers.objects.filter(o => o.kind === "prop");
console.log("  prop types in this world:", [...new Set(world.props.map(p => p.type))].join(","));
console.log("  first prop svg bytes:", props[0]?.svg.length, props[0]?.svg.slice(0, 160));
console.log("  terrain carries <image>/<img>?:", /<image|<img/.test(layers.terrainSvg));
console.log("  world-id attr:", (layers.terrainSvg.match(/data-world-id="[^"]+"/) ?? [])[0]);
for (const type of ["vent", "terminal", "crate", "tank"]) {
  const svg = renderProp(type);
  console.log(`  renderProp(${type}) bytes=${svg.length} head=${svg.slice(0, 80)}`);
}
console.log("--- chain side ---");
const client = createPublicClient({ transport: http("https://rpc.mainnet.chain.robinhood.com") });
for (const [name, address] of [["seededLandscape", "0x450E3a18cb4d0264C61ff6468FC988FD9F78967D"], ["worldData", "0xB78F68992d4c61c491EDCCa7890a05e7DBeb3970"]]) {
  const code = await client.getCode({ address });
  console.log(`  ${name} ${address} bytecode bytes:`, code ? (code.length - 2) / 2 : "EOA (no code)");
}
