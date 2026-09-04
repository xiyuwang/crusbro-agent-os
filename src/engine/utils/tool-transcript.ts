/**
 * Anthropic Messages tool_use / tool_result pairing rules (Crusbro runtime).
 */

import type { ContentBlock, Message } from "../core/types.js";

function messageBlocks(msg: Message): ContentBlock[] {
  const blocks =
    msg.metadata?.transport === "omit" ? msg.content : msg.metadata?.content_blocks ?? msg.content;
  return Array.isArray(blocks) ? blocks : [];
}

function getToolUseIds(msg: Message): string[] {
  return messageBlocks(msg)
    .filter((b): b is Extract<ContentBlock, { type: "tool_use" }> => b.type === "tool_use")
    .map((b) => b.id);
}

function getToolResultIds(msg: Message): string[] {
  return messageBlocks(msg)
    .filter((b): b is Extract<ContentBlock, { type: "tool_result" }> => b.type === "tool_result")
    .map((b) => b.tool_use_id);
}

export function anthropicToolTranscriptPairingValid(messages: Message[]): boolean {
  let pending: string[] | null = null;
  for (const msg of messages) {
    if (msg.role === "system") continue;
    if (msg.role === "assistant") {
      if (pending != null && pending.length > 0) return false;
      const ids = getToolUseIds(msg);
      pending = ids.length > 0 ? ids : null;
      continue;
    }
    if (msg.role === "user") {
      const resultIds = getToolResultIds(msg);
      if (pending != null && pending.length > 0) {
        const pend = pending;
        const resultSet = new Set(resultIds);
        if (pend.some((id) => !resultSet.has(id))) return false;
        if (resultIds.some((id) => !pend.includes(id))) return false;
        pending = null;
      } else if (resultIds.length > 0) {
        return false;
      }
      continue;
    }
    return false;
  }
  return true;
}

export function clampRetainStartForAnthropicToolPairing(messages: Message[], desiredStart: number): number {
  const n = messages.length;
  if (n === 0) return 0;
  let s = Math.max(0, Math.min(Math.floor(desiredStart), n));
  while (!anthropicToolTranscriptPairingValid(messages.slice(s))) {
    if (s === 0) return anthropicToolTranscriptPairingValid(messages) ? 0 : -1;
    s -= 1;
  }
  return s;
}

export function findFirstAnthropicValidSuffixStart(messages: Message[]): number {
  const n = messages.length;
  for (let i = 0; i < n; i++) {
    if (anthropicToolTranscriptPairingValid(messages.slice(i))) return i;
  }
  return n === 0 ? 0 : -1;
}

export function clipAnthropicToolOrphansFromPrefix(messages: Message[]): Message[] {
  const i = findFirstAnthropicValidSuffixStart(messages);
  if (i <= 0) return messages;
  if (messages[0]?.role === "system") {
    const withSystem: Message[] = [messages[0], ...messages.slice(i)];
    if (anthropicToolTranscriptPairingValid(withSystem)) return withSystem;
  }
  return messages.slice(i);
}
