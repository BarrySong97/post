/**
 * @purpose 读取 .env 凭据并用 aws4fetch 把对象 PUT 到 Cloudflare R2(S3 兼容),返回公开 URL。
 * @role    scripts/img.mjs 的上传层;封装 .env 解析、SigV4 签名与 endpoint 拼接。
 * @deps    aws4fetch(SigV4 签名 fetch)、node:fs(读 .env)
 * @gotcha  R2 需显式 service=s3 / region=auto;缺任一必填变量则抛错;上传用 immutable 强缓存头(配合内容寻址命名)。
 */
import { readFileSync, existsSync } from "node:fs";
import { AwsClient } from "aws4fetch";

/** 极简 .env 解析(避免依赖 dotenv / node --env-file 版本要求);已存在的 process.env 优先级更低被覆盖。 */
export function loadEnv(path = ".env") {
  const env = { ...process.env };
  if (existsSync(path)) {
    for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
      if (/^\s*#/.test(line) || !line.trim()) continue;
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      let v = m[2].trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      env[m[1]] = v;
    }
  }
  return env;
}

/** 从 env 取出并校验 R2 配置;缺变量抛错。 */
export function r2Config(env) {
  const need = [
    "R2_ACCOUNT_ID",
    "R2_ACCESS_KEY_ID",
    "R2_SECRET_ACCESS_KEY",
    "R2_BUCKET",
    "R2_PUBLIC_BASE",
  ];
  const missing = need.filter((k) => !env[k]);
  if (missing.length) {
    throw new Error(`缺少 R2 环境变量: ${missing.join(", ")}(把 .env.example 复制成 .env 并填好)`);
  }
  return {
    accountId: env.R2_ACCOUNT_ID,
    accessKeyId: env.R2_ACCESS_KEY_ID,
    secretAccessKey: env.R2_SECRET_ACCESS_KEY,
    bucket: env.R2_BUCKET,
    publicBase: env.R2_PUBLIC_BASE.replace(/\/+$/, ""),
    keyPrefix: (env.R2_KEY_PREFIX || "blog").replace(/^\/+|\/+$/g, ""),
  };
}

export function publicUrl(cfg, key) {
  return `${cfg.publicBase}/${key}`;
}

/** PUT 一个对象到 R2,返回公开 URL。 */
export async function uploadToR2(cfg, key, body, contentType) {
  const client = new AwsClient({
    accessKeyId: cfg.accessKeyId,
    secretAccessKey: cfg.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  const endpoint = `https://${cfg.accountId}.r2.cloudflarestorage.com/${cfg.bucket}/${key}`;
  const res = await client.fetch(endpoint, {
    method: "PUT",
    body,
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`R2 上传失败 ${res.status} ${res.statusText}: ${text}`);
  }
  return publicUrl(cfg, key);
}
