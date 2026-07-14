/**
 * @purpose 博客图片管线 CLI:扫某篇 MDX 的图片(本地 / 远程 http(s)),压缩+上传 R2,就地改写成 <BlogImage/>。
 * @role    `pnpm img <slug|mdx路径>` 的入口;编排 process-image 与 r2 上传,改写 MDX;封面 frontmatter 同样处理。
 * @deps    本目录 lib/process-image、lib/r2;node:fs/path;远程图用全局 fetch。
 * @gotcha  支持 ![](url) 与 ![](<url>) 两种语法;--dry-run 不上传;幂等(已在我们 R2 的图跳过,无转换则不写)。
 *          Velite MDX 通过 components 注入 <BlogImage>(见 app/components/blog/mdx-content.tsx),故无需在 MDX 顶部 import。
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve, dirname, join, isAbsolute } from "node:path";
import { processImage } from "./lib/process-image.mjs";
import { loadEnv, r2Config, uploadToR2 } from "./lib/r2.mjs";

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const positional = args.filter((a) => !a.startsWith("--"));
const target = positional[0];

if (!target) {
  console.error("用法: pnpm img <slug 或 mdx 路径> [--dry-run]");
  process.exit(1);
}

const BLOG_DIR = resolve("content/blog");

function resolveMdx(t) {
  if (existsSync(t) && /\.mdx?$/.test(t)) return resolve(t);
  for (const ext of [".mdx", ".md"]) {
    const p = join(BLOG_DIR, t + ext);
    if (existsSync(p)) return p;
  }
  return null;
}

const mdxPath = resolveMdx(target);
if (!mdxPath) {
  console.error(`找不到文章: ${target}(既不是 mdx 文件,也不是 ${BLOG_DIR} 下的 slug)`);
  process.exit(1);
}

let content = readFileSync(mdxPath, "utf8");
const mdxDir = dirname(mdxPath);

// markdown 图片:![alt](<url>) 尖括号形式,或 ![alt](url)——url 允许含空格与成对括号;跳过 data: 与协议相对 //
const IMG_RE = /!\[([^\]]*)\]\((?:<([^>]+)>|((?:[^()\n]|\([^()\n]*\))*))\)/g;
const matches = [...content.matchAll(IMG_RE)]
  .map((m) => ({ full: m[0], alt: m[1], src: (m[2] ?? m[3]).trim() }))
  .filter((m) => !/^(data:|\/\/)/i.test(m.src));

const cfg = dryRun ? null : r2Config(loadEnv());
console.log(`处理 ${mdxPath} — 正文 ${matches.length} 张待处理${dryRun ? "(dry-run,不上传)" : ""}`);

/** 下载远程图片并校验确实是图片;重试 3 次应对 Cloudflare 偶发的 HTML 挑战页 */
async function fetchImage(url) {
  let lastErr;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const res = await fetch(url, { redirect: "follow" });
      if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
      const ct = res.headers.get("content-type") || "";
      if (!/^image\//i.test(ct)) throw new Error(`返回的不是图片(content-type=${ct || "?"})`);
      return Buffer.from(await res.arrayBuffer());
    } catch (e) {
      lastErr = e;
      if (attempt < 3) await new Promise((r) => setTimeout(r, 600 * attempt));
    }
  }
  throw lastErr;
}

/** 取图片字节:远程 http(s) 下载;本地按路径读(mdx 同目录 / public / 仓库相对) */
async function loadImageBytes(srcRaw) {
  if (/^https?:/i.test(srcRaw)) return fetchImage(srcRaw);
  const src = srcRaw.replace(/^\.\//, "");
  const candidates = [
    isAbsolute(src) ? src : resolve(mdxDir, src),
    resolve("public", src.replace(/^\//, "")),
    resolve(src),
  ];
  const found = candidates.find((p) => existsSync(p));
  if (found) return readFileSync(found);
  throw new Error("找不到本地文件,也无法解析为远程图");
}

let converted = 0;
for (const { full, alt: altRaw, src: srcRaw } of matches) {
  // 跳过已经是我们 R2 输出的图(避免二次有损压缩)
  if (cfg && srcRaw.startsWith(`${cfg.publicBase}/${cfg.keyPrefix}/`)) {
    console.log(`  · 跳过(已在我们的 R2): ${srcRaw}`);
    continue;
  }

  let bytes;
  try {
    bytes = await loadImageBytes(srcRaw);
  } catch (e) {
    console.warn(`  ⚠️ 跳过 ${srcRaw}: ${e.message}`);
    continue;
  }

  const { webpBuffer, width, height, hash, thumbhash } = await processImage(bytes);
  const kb = (webpBuffer.length / 1024).toFixed(0);
  const prefix = dryRun ? "<prefix>" : cfg.keyPrefix;
  const key = `${prefix}/${hash}.webp`;

  let url;
  if (dryRun) {
    url = `<R2_PUBLIC_BASE>/${key}`;
    console.log(
      `  · ${srcRaw} → ${hash}.webp  ${width}x${height} ${kb}KB  th=${thumbhash.length}b  [未上传]`,
    );
  } else {
    url = await uploadToR2(cfg, key, webpBuffer, "image/webp");
    console.log(`  · ${srcRaw} → ${url}  ${width}x${height} ${kb}KB`);
  }

  const alt = altRaw.replace(/"/g, "&quot;");
  const tag = `<BlogImage src="${url}" alt="${alt}" width={${width}} height={${height}} thumbhash="${thumbhash}" />`;
  content = content.replace(full, () => tag); // 函数式替换,避免 $ 特殊串
  converted++;
}

// ── 处理封面图(frontmatter cover)→ 同样压缩/上传/thumbhash,结果写回 frontmatter ──
function setFmField(fm, key, value) {
  const re = new RegExp(`^${key}\\s*:.*$`, "m");
  return re.test(fm) ? fm.replace(re, () => `${key}: ${value}`) : `${fm}\n${key}: ${value}`;
}

let coverChanged = false;
const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
if (fmMatch) {
  const inner = fmMatch[2];
  const coverM = inner.match(/^cover\s*:\s*["']?([^"'\n]+?)["']?\s*$/m);
  const coverVal = coverM?.[1]?.trim();
  const alreadyOurs = cfg && coverVal && coverVal.startsWith(`${cfg.publicBase}/${cfg.keyPrefix}/`);
  const alreadyDone = /^coverThumbhash\s*:/m.test(inner);
  if (coverVal && !alreadyOurs && !alreadyDone) {
    try {
      const { webpBuffer, width, height, hash, thumbhash } = await processImage(
        await loadImageBytes(coverVal),
      );
      const key = `${dryRun ? "<prefix>" : cfg.keyPrefix}/${hash}.webp`;
      const url = dryRun
        ? `<R2_PUBLIC_BASE>/${key}`
        : await uploadToR2(cfg, key, webpBuffer, "image/webp");
      console.log(
        `  封面 ${coverVal} → ${url}  ${width}x${height} ${(webpBuffer.length / 1024).toFixed(0)}KB`,
      );
      let ni = setFmField(inner, "cover", `"${url}"`);
      ni = setFmField(ni, "coverWidth", String(width));
      ni = setFmField(ni, "coverHeight", String(height));
      ni = setFmField(ni, "coverThumbhash", `"${thumbhash}"`);
      content = fmMatch[1] + ni + fmMatch[3] + content.slice(fmMatch[0].length);
      coverChanged = true;
    } catch (e) {
      console.warn(`  ⚠️ 封面跳过 ${coverVal}: ${e.message}`);
    }
  } else if (coverVal && (alreadyOurs || alreadyDone)) {
    console.log("  封面已处理,跳过");
  }
}

if (converted === 0 && !coverChanged) {
  console.log("无改动(图片都已处理 / 下载失败)——不改写文件。");
  process.exit(0);
}

if (dryRun) {
  console.log(`dry-run:未写回 MDX(正文 ${converted} 张${coverChanged ? " + 封面" : ""})。`);
  process.exit(0);
}

writeFileSync(mdxPath, content, "utf8");
console.log(`✅ 已改写 ${mdxPath}(正文 ${converted} 张${coverChanged ? " + 封面" : ""})`);
