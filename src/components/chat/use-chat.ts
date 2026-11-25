"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ConversationStatus, MessageMeta, MessageRole } from "@/server/db/schema";

export interface ChatMessage {
  id: string;
  role: MessageRole;
  content: string;
  meta?: MessageMeta;
  pending?: boolean;
}

export interface ToolActivity {
  id: string;
  name: string;
  done: boolean;
  ok?: boolean;
}

const STORAGE_KEY = "nimbus.conversation";

function readStoredId(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY);
  } catch {
    return null;
  }
}
function storeId(id: string | null) {
  try {
    if (id) localStorage.setItem(STORAGE_KEY, id);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode): the chat still works for this page view */
  }
}

/**
 * Chat state for the widget: streams agent turns over SSE, and while a human owns the
 * conversation polls for operator messages every 2 seconds.
 */
export function useChat() {
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [status, setStatus] = useState<ConversationStatus>("bot");
  const [busy, setBusy] = useState(false);
  const [tools, setTools] = useState<ToolActivity[]>([]);
  const [error, setError] = useState<string | null>(null);
  const lastIdRef = useRef(0);

  const applyServerMessages = useCallback(
    (rows: { id: number; role: MessageRole; content: string; meta: MessageMeta }[]) => {
      if (!rows.length) return;
      lastIdRef.current = Math.max(lastIdRef.current, ...rows.map((r) => r.id));
      setMessages((prev) => {
        const known = new Set(prev.map((m) => m.id));
        const fresh = rows
          .filter((r) => !known.has(`s${r.id}`))
          .map((r) => ({ id: `s${r.id}`, role: r.role, content: r.content, meta: r.meta }));
        return fresh.length ? [...prev, ...fresh] : prev;
      });
    },
    [],
  );

  const poll = useCallback(
    async (id: string, all = false) => {
      const res = await fetch(`/api/conversations/${id}/messages?after=${all ? 0 : lastIdRef.current}`);
      if (res.status === 404) {
        storeId(null);
        setConversationId(null);
        return;
      }
      if (!res.ok) return;
      const data = (await res.json()) as {
        status: ConversationStatus;
        messages: { id: number; role: MessageRole; content: string; meta: MessageMeta }[];
      };
      setStatus(data.status);
      applyServerMessages(data.messages);
    },
    [applyServerMessages],
  );

  // Restore the conversation after a reload. Reading storage after mount keeps SSR and the
  // first client render identical.
  useEffect(() => {
    const stored = readStoredId();
    if (!stored) return;
    void (async () => {
      const res = await fetch(`/api/conversations/${stored}/messages?after=0`);
      if (!res.ok) {
        storeId(null);
        return;
      }
      setConversationId(stored);
      const data = (await res.json()) as {
        status: ConversationStatus;
        messages: { id: number; role: MessageRole; content: string; meta: MessageMeta }[];
      };
      setStatus(data.status);
      applyServerMessages(data.messages);
    })();
  }, [applyServerMessages]);

  // While a human is (or should be) in the conversation, poll for their replies.
  useEffect(() => {
    if (!conversationId || status === "bot" || busy) return;
    const timer = setInterval(() => void poll(conversationId), 2000);
    return () => clearInterval(timer);
  }, [conversationId, status, busy, poll]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setBusy(true);
      setError(null);
      setTools([]);
      const localUser: ChatMessage = { id: `u${Date.now()}`, role: "user", content: message };
      const draftId = `a${Date.now()}`;
      setMessages((prev) => [...prev, localUser]);

      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ conversationId: conversationId ?? undefined, message }),
        });
        if (!res.ok || !res.body) {
          const body = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Request failed (${res.status})`);
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        // Updaters must be pure (React may call them twice), so the draft is found by id.
        const upsertDraft = (patch: (m: ChatMessage) => ChatMessage) =>
          setMessages((prev) =>
            prev.some((m) => m.id === draftId)
              ? prev.map((m) => (m.id === draftId ? patch(m) : m))
              : [...prev, patch({ id: draftId, role: "assistant", content: "", pending: true })],
          );

        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buffer += decoder.decode(value, { stream: true });
          const frames = buffer.split("\n\n");
          buffer = frames.pop() ?? "";
          for (const frame of frames) {
            const line = frame.split("\n").find((l) => l.startsWith("data: "));
            if (!line) continue;
            const event = JSON.parse(line.slice(6));
            switch (event.type) {
              case "conversation":
                setConversationId(event.id);
                storeId(event.id);
                break;
              case "user_message":
                lastIdRef.current = Math.max(lastIdRef.current, event.id);
                setMessages((prev) => prev.map((m) => (m.id === localUser.id ? { ...m, id: `s${event.id}` } : m)));
                break;
              case "text":
                upsertDraft((m) => ({ ...m, content: m.content + event.delta }));
                break;
              case "tool_start":
                setTools((prev) => [...prev, { id: event.id, name: event.name, done: false }]);
                break;
              case "tool_end":
                setTools((prev) => prev.map((t) => (t.id === event.id ? { ...t, done: true, ok: event.ok } : t)));
                break;
              case "handoff":
                setStatus("needs_human");
                break;
              case "queued_for_human":
                break;
              case "done":
                lastIdRef.current = Math.max(lastIdRef.current, event.messageId);
                upsertDraft((m) => ({ ...m, id: `s${event.messageId}`, meta: event.meta, pending: false }));
                break;
              case "error":
                setError(event.message);
                break;
            }
          }
        }
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
        setTools([]);
      }
    },
    [busy, conversationId],
  );

  const reset = useCallback(() => {
    storeId(null);
    setConversationId(null);
    setMessages([]);
    setStatus("bot");
    setError(null);
    lastIdRef.current = 0;
  }, []);

  return { conversationId, messages, status, busy, tools, error, send, reset };
}
