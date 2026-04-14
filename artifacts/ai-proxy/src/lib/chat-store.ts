const STORAGE_KEY = "vesper.chatHistory";
const MAX_CONVERSATIONS = 50;

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  aiId?: string;
  error?: boolean;
  routingInfo?: { aiId: string; reason: string; signals: string[]; confidence: number };
  timestamp: string;
}

export interface Conversation {
  id: string;
  title: string;
  messages: ChatMessage[];
  createdAt: string;
  updatedAt: string;
  aiId?: string;
}

function generateId(): string {
  return `conv_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function autoTitle(firstMessage: string): string {
  const cleaned = firstMessage.replace(/\n/g, " ").trim();
  if (cleaned.length <= 50) return cleaned;
  return cleaned.slice(0, 47) + "…";
}

function loadAll(): Conversation[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as Conversation[];
  } catch {
    return [];
  }
}

function saveAll(conversations: Conversation[]) {
  try {
    const trimmed = conversations.slice(0, MAX_CONVERSATIONS);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch { /* quota exceeded — silently fail */ }
}

export function listConversations(): Conversation[] {
  return loadAll().sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

export function getConversation(id: string): Conversation | null {
  return loadAll().find(c => c.id === id) ?? null;
}

export function createConversation(firstMessage?: string): Conversation {
  const now = new Date().toISOString();
  const conv: Conversation = {
    id: generateId(),
    title: firstMessage ? autoTitle(firstMessage) : "New Chat",
    messages: [],
    createdAt: now,
    updatedAt: now,
  };
  const all = loadAll();
  all.unshift(conv);
  saveAll(all);
  return conv;
}

export function saveMessages(id: string, messages: ChatMessage[]) {
  const all = loadAll();
  const idx = all.findIndex(c => c.id === id);
  if (idx === -1) return;
  all[idx].messages = messages;
  all[idx].updatedAt = new Date().toISOString();
  if (all[idx].title === "New Chat" && messages.length > 0) {
    const first = messages.find(m => m.role === "user");
    if (first) all[idx].title = autoTitle(first.content);
  }
  if (idx > 0) {
    const [moved] = all.splice(idx, 1);
    all.unshift(moved);
  }
  saveAll(all);
}

export function renameConversation(id: string, title: string) {
  const all = loadAll();
  const conv = all.find(c => c.id === id);
  if (conv) {
    conv.title = title.trim() || "Untitled";
    conv.updatedAt = new Date().toISOString();
    saveAll(all);
  }
}

export function deleteConversation(id: string) {
  const all = loadAll().filter(c => c.id !== id);
  saveAll(all);
}

export function clearAllConversations() {
  try { localStorage.removeItem(STORAGE_KEY); } catch {}
}
