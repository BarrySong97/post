/**
 * @purpose 单张图片处理:sharp 压成限宽 WebP、用 blake2b 内容哈希命名、生成 thumbhash 模糊占位串。
 * @role    被 scripts/img.mjs 调用;纯处理(无网络/无 MDX),输入文件 buffer → 产出上传所需元信息。
 * @deps    sharp(压缩/取像素)、thumbhash(rgbaToThumbHash)、node:crypto(blake2b512)
 * @gotcha  thumbhash 要求像素 ≤100x100,先缩小取 raw RGBA;hash 取压缩后内容前 32 hex(内容寻址、可永久缓存)。
 */
import sharp from "sharp";
import { createHash } from "node:crypto";
import { rgbaToThumbHash } from "thumbhash";

/**
 * @param {Buffer} inputBuf 原图字节
 * @param {{maxWidth?:number, quality?:number}} opts
 * @returns {Promise<{webpBuffer:Buffer,width:number,height:number,hash:string,thumbhash:string}>}
 */
export async function processImage(inputBuf, { maxWidth = 1600, quality = 80 } = {}) {
  const meta = await sharp(inputBuf, { failOn: "none" }).metadata();

  // 压缩:尊重 EXIF 方向 → 限宽(不放大) → WebP
  const pipeline = sharp(inputBuf, { failOn: "none" }).rotate();
  if (meta.width && meta.width > maxWidth) pipeline.resize({ width: maxWidth });
  const out = await pipeline.webp({ quality }).toBuffer({ resolveWithObject: true });
  const webpBuffer = out.data;
  const width = out.info.width;
  const height = out.info.height;

  // 内容哈希命名(blake2b512 → 前 32 hex)
  const hash = createHash("blake2b512").update(webpBuffer).digest("hex").slice(0, 32);

  // thumbhash:缩到 ≤100x100,取 raw RGBA
  const small = await sharp(webpBuffer)
    .resize({ width: 100, height: 100, fit: "inside" })
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const th = rgbaToThumbHash(small.info.width, small.info.height, small.data);
  const thumbhash = Buffer.from(th).toString("base64");

  return { webpBuffer, width, height, hash, thumbhash };
}
