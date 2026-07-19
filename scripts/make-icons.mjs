// Generates PWA icons from a simple SVG mark (paper + ink bullet).
// Run: node scripts/make-icons.mjs
import sharp from "sharp";
import { mkdirSync } from "node:fs";

const mark = (size, { rounded = false, dotScale = 0.2 } = {}) => {
  const r = Math.round(size * dotScale);
  const rx = rounded ? Math.round(size * 0.22) : 0;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">
       <rect width="${size}" height="${size}" rx="${rx}" fill="#F5F4EF"/>
       <circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="#26323E"/>
     </svg>`
  );
};

mkdirSync("public", { recursive: true });

await sharp(mark(192)).png().toFile("public/icon-192.png");
await sharp(mark(512)).png().toFile("public/icon-512.png");
// maskable: smaller dot so it survives the safe-zone crop
await sharp(mark(512, { dotScale: 0.16 }))
  .png()
  .toFile("public/icon-maskable-512.png");
await sharp(mark(180)).png().toFile("public/apple-touch-icon.png");

console.log("icons written to public/");
