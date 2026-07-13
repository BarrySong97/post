"use client";

/**
 * @purpose Give AI coding agents (Claude Code, Cursor, Codex) one copyable instruction for setting
 *          themselves up against a Post vault, instead of a human-facing terminal install snippet.
 * @role    Client component (needs clipboard + click state) mounted inside the server-rendered hero.
 * @deps    @heroui/react Button, navigator.clipboard.
 * @gotcha  Keep the skill install command inside AGENT_INSTRUCTION in sync with skills/post/SKILL.md
 *          ("Install this skill") — installing the skill is what teaches the agent to install and
 *          drive post-cli, so there's no separate CLI command to spell out here.
 */
import { Button } from "@heroui/react";
import { useState } from "react";

const SKILL_INSTALL_COMMAND = "npx skills add BarrySong97/post -s post";
const AGENT_INSTRUCTION = `Install the Post skill — ${SKILL_INSTALL_COMMAND} — then use post-cli through it to organize this vault.`;

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
    >
      <rect x="9" y="9" width="12" height="12" rx="2" />
      <path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M4.5 12.5l5 5L19.5 6.5" />
    </svg>
  );
}

export function AgentSetupNote() {
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(AGENT_INSTRUCTION);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard permission can be denied; the sentence is still visible to copy by hand.
    }
  };

  return (
    <div className="mt-4 flex max-w-lg items-center gap-3 rounded-2xl border border-foreground/5 bg-background/45 px-4 py-3 text-[13px] leading-relaxed text-foreground/70 backdrop-blur-md">
      <p className="flex-1">
        Install the Post skill —{" "}
        <code className="font-mono text-foreground">{SKILL_INSTALL_COMMAND}</code> — then use
        post-cli through it to organize this vault.
      </p>
      <Button
        isIconOnly
        size="sm"
        variant="ghost"
        aria-label={copied ? "Copied" : "Copy for your AI agent"}
        className="h-8 w-8 min-w-8 shrink-0 rounded-full text-foreground/45"
        onPress={copy}
      >
        {copied ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </div>
  );
}
