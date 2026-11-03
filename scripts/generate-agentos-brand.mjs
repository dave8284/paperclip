// Code-native brand assets derived from Friday's Fibonacci particle sphere.
// Run with the repository Node toolchain; no graphics service or paid asset is used.
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { resolve } from "node:path";
import { orbPoints } from "../ui/src/lib/friday-orb.ts";
import { CAP_V1_COLORS } from "../packages/shared/src/cliplab/palette-tokens.ts";

const root = resolve(import.meta.dirname, ".."), publicDir = resolve(root, "ui/public");
const colour = hex => hex.replace("#", "").match(/../g).map(value => parseInt(value, 16));
const neutral = [colour("#586481"), colour("#9c8ac6")];
function dots(size, colors = neutral, count = 420) {
  return orbPoints(count).map(point => {
    const y = point.y * Math.cos(-.22) - point.z * Math.sin(-.22);
    const depth = point.y * Math.sin(-.22) + point.z * Math.cos(-.22);
    const perspective = 2.8 / (2.8 - depth * .35);
    const blend = (point.y + 1) / 2;
    return { x: size / 2 + point.x * size * .36 * perspective, y: size / 2 + y * size * .36 * perspective,
      r: size * (.0021 + (depth + 1) * .0021), depth, opacity: .18 + (depth + 1) * .38,
      color: colors[0].map((value, index) => Math.round(value * blend + colors[1][index] * (1 - blend))) };
  }).sort((a, b) => a.depth - b.depth);
}
const hex = rgb => `#${rgb.map(value => value.toString(16).padStart(2, "0")).join("")}`;
function svg(colors = neutral, { background = false, title = "AgentOS", count = 420 } = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128"><title>${title}</title>${background ? '<rect width="128" height="128" rx="28" fill="#ffffff"/>' : ""}<g>${dots(128, colors, count).map(dot => `<circle cx="${dot.x.toFixed(2)}" cy="${dot.y.toFixed(2)}" r="${dot.r.toFixed(2)}" fill="${hex(dot.color)}" opacity="${dot.opacity.toFixed(2)}"/>`).join("")}</g></svg>\n`;
}
// A tiny PNG encoder keeps app-icon generation reproducible without a native
// graphics dependency. Circle coverage is antialiased at the target resolution.
function crc(bytes) {
  let value = 0xffffffff;
  for (const byte of bytes) { value ^= byte; for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ (value & 1 ? 0xedb88320 : 0); }
  return (value ^ 0xffffffff) >>> 0;
}
function chunk(kind, bytes) {
  const type = Buffer.from(kind), length = Buffer.alloc(4), checksum = Buffer.alloc(4);
  length.writeUInt32BE(bytes.length); checksum.writeUInt32BE(crc(Buffer.concat([type, bytes])));
  return Buffer.concat([length, type, bytes, checksum]);
}
function png(size) {
  const pixels = new Uint8Array(size * size * 4).fill(255);
  for (const dot of dots(size, neutral, size <= 32 ? 120 : 420)) {
    const radius = Math.max(dot.r, size <= 32 ? .55 : .4);
    for (let y = Math.max(0, Math.floor(dot.y - radius - 1)); y <= Math.min(size - 1, Math.ceil(dot.y + radius + 1)); y++) {
      for (let x = Math.max(0, Math.floor(dot.x - radius - 1)); x <= Math.min(size - 1, Math.ceil(dot.x + radius + 1)); x++) {
        const coverage = Math.max(0, Math.min(1, radius + .5 - Math.hypot(x + .5 - dot.x, y + .5 - dot.y))) * dot.opacity;
        const offset = (y * size + x) * 4;
        for (let channel = 0; channel < 3; channel++) pixels[offset + channel] = Math.round(pixels[offset + channel] * (1 - coverage) + dot.color[channel] * coverage);
      }
    }
  }
  const rows = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rows.set(pixels.subarray(y * size * 4, (y + 1) * size * 4), y * (size * 4 + 1) + 1);
  const header = Buffer.alloc(13); header.writeUInt32BE(size); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", header), chunk("IDAT", deflateSync(rows)), chunk("IEND", Buffer.alloc(0))]);
}
function ico(images) {
  const header = Buffer.alloc(6 + 16 * images.length); header.writeUInt16LE(1, 2); header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach(({ size, bytes }, index) => { const start = 6 + index * 16; header[start] = header[start + 1] = size; header.writeUInt16LE(1, start + 4); header.writeUInt16LE(32, start + 6); header.writeUInt32LE(bytes.length, start + 8); header.writeUInt32LE(offset, start + 12); offset += bytes.length; });
  return Buffer.concat([header, ...images.map(image => image.bytes)]);
}
const mark = svg(neutral, { background: true });
for (const name of ["agentos-mark.svg", "favicon.svg", "worktree-favicon.svg"]) writeFileSync(resolve(publicDir, name), mark);
// Old URLs remain compatibility aliases, but never contain inherited artwork.
writeFileSync(resolve(publicDir, "paperclip-thinking.svg"), svg());
const pngs = new Map([16, 32, 180, 192, 512].map(size => [size, png(size)]));
for (const [name, size] of [["favicon-16x16.png", 16], ["favicon-32x32.png", 32], ["worktree-favicon-16x16.png", 16], ["worktree-favicon-32x32.png", 32], ["apple-touch-icon.png", 180], ["android-chrome-192x192.png", 192], ["android-chrome-512x512.png", 512]]) writeFileSync(resolve(publicDir, name), pngs.get(size));
for (const name of ["favicon.ico", "worktree-favicon.ico"]) writeFileSync(resolve(publicDir, name), ico([16, 32].map(size => ({ size, bytes: pngs.get(size) }))));
mkdirSync(resolve(publicDir, "agentos-orbs"), { recursive: true });
for (const [name, colors] of Object.entries(CAP_V1_COLORS)) writeFileSync(resolve(publicDir, "agentos-orbs", `${name}.svg`), svg([colour(colors.a), colour(colors.b)], { title: "Agent" }));
const offline = readFileSync(resolve(publicDir, "sw.js"), "utf8").replace(/<svg class="agentos-offline-character"[\s\S]*?<\/svg>/, svg().trim().replace("<svg ", '<svg class="agentos-offline-character" aria-hidden="true" '));
writeFileSync(resolve(publicDir, "sw.js"), offline);
console.log("AgentOS orb brand assets generated.");
