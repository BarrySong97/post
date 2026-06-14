#!/usr/bin/env node
/**
 * @purpose PostToolUse 质量回灌:改完文件后跑格式化/lint,把报错作为 additionalContext 喂回 agent 自纠。
 * @role    强制层 sensor(最快层,毫秒~秒);Claude / Codex 共用。
 * @deps    node 内置 child_process/path + pnpm exec oxfmt/oxlint
 * @gotcha  只处理 OXC 支持的前端源码/配置文件;成功静默,只在有问题时回灌。
 */
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { extname } from "node:path";

let payload = {};
try {
  payload = JSON.parse(readFileSync(0, "utf8") || "{}");
} catch {}
const file = payload?.tool_input?.file_path ?? "";
if (!file) process.exit(0);

const FORMAT_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs", ".json", ".css"]);
const LINT_EXTS = new Set([".js", ".jsx", ".ts", ".tsx", ".mjs", ".cjs"]);
const ext = extname(file);
if (!FORMAT_EXTS.has(ext) && !LINT_EXTS.has(ext)) process.exit(0);

try {
  if (FORMAT_EXTS.has(ext)) {
    execFileSync("pnpm", ["exec", "oxfmt", "--write", file, "--no-error-on-unmatched-pattern"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  if (LINT_EXTS.has(ext)) {
    execFileSync("pnpm", ["exec", "oxlint", file, "--no-error-on-unmatched-pattern"], {
      stdio: ["ignore", "pipe", "pipe"],
    });
  }
  process.exit(0); // 成功:静默
} catch (e) {
  const out = `${e.stdout ?? ""}${e.stderr ?? ""}`.trim();
  if (out) {
    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "PostToolUse",
          additionalContext: `Lint/format 报告(${file}):\n${out}`,
        },
      }),
    );
  }
  process.exit(0);
}
