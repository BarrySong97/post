#!/usr/bin/env node
/**
 * @purpose PreToolUse 文件保护门:拦截通过 Write/Edit 改 .env / 密钥 / lint 配置等敏感文件。
 * @role    强制层 sensor;补 guard.mjs(只管 Bash)的盲区。Claude(Write|Edit)与 Codex(apply_patch=Edit|Write)共用。
 * @deps    node 内置;读 stdin hook JSON 的 tool_input.file_path
 * @gotcha  非安全边界;按需增删 RULES。Codex apply_patch 无 file_path 时退化为扫描补丁文本,可能漏判。
 */
import { readFileSync } from 'node:fs';

let payload = {};
try { payload = JSON.parse(readFileSync(0, 'utf8') || '{}'); } catch {}
const ti = payload?.tool_input ?? {};
const fp = ti.file_path ?? ti.path ?? '';
const patch = typeof ti.input === 'string' ? ti.input : '';   // Codex apply_patch 补丁文本(best-effort)
const targets = [fp, patch].filter(Boolean);

const RULES = [
  { re: /(^|\/)\.env($|\.)/, why: '禁止改 .env(密钥/环境变量),请人工处理。' },
  { re: /\.(pem|key|p12|keystore)$|(^|\/)id_rsa/, why: '禁止改密钥/证书文件。' },
  { re: /(^|\/)\.(eslintrc|oxlintrc|prettierrc|stylelintrc)|(^|\/)biome\.json$/, why: '禁止改 lint/格式化配置(不得靠改配置消除告警,请改代码)。' },
];

for (const r of RULES) {
  if (targets.some((t) => r.re.test(t))) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: { hookEventName: 'PreToolUse', permissionDecision: 'deny', permissionDecisionReason: r.why },
    }));
    process.exit(0);
  }
}
process.exit(0);
