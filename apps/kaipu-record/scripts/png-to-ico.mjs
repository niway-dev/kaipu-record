// Packs square PNGs into one multi-size .ico, each entry stored as PNG (the
// format Windows has read since Vista). No dependencies: an .ico is a 6-byte
// header, a 16-byte directory entry per image, then the images themselves.
//
//   node scripts/png-to-ico.mjs <out.ico> <a.png> [b.png ...]
import { readFileSync, writeFileSync } from "node:fs";

const [out, ...inputs] = process.argv.slice(2);
if (!out || inputs.length === 0) {
  console.error("usage: png-to-ico.mjs <out.ico> <a.png> [b.png ...]");
  process.exit(1);
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const images = inputs.map((path) => {
  const data = readFileSync(path);
  if (!data.subarray(0, 8).equals(PNG_SIGNATURE)) throw new Error(`${path} is not a PNG`);
  // IHDR is always the first chunk: width and height follow the 8-byte chunk header.
  const width = data.readUInt32BE(16);
  const height = data.readUInt32BE(20);
  if (width !== height || width > 256) throw new Error(`${path} is ${width}x${height}`);
  return { data, size: width };
});

const header = Buffer.alloc(6);
header.writeUInt16LE(0, 0); // reserved
header.writeUInt16LE(1, 2); // type: icon
header.writeUInt16LE(images.length, 4);

let offset = header.length + 16 * images.length;
const entries = images.map(({ data, size }) => {
  const entry = Buffer.alloc(16);
  entry.writeUInt8(size === 256 ? 0 : size, 0); // width (0 means 256)
  entry.writeUInt8(size === 256 ? 0 : size, 1); // height
  entry.writeUInt8(0, 2); // palette size: none
  entry.writeUInt8(0, 3); // reserved
  entry.writeUInt16LE(1, 4); // colour planes
  entry.writeUInt16LE(32, 6); // bits per pixel
  entry.writeUInt32LE(data.length, 8);
  entry.writeUInt32LE(offset, 12);
  offset += data.length;
  return entry;
});

writeFileSync(out, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
