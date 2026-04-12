/**
 * export-chat.ts — Vesper IDE chat export utilities.
 *
 * PDF  : Opens a styled print-window with full markdown + code formatting
 *        and auto-triggers the browser's native Print → Save as PDF flow.
 *        Zero dependencies, perfect rendering on all platforms.
 *
 * Word : Uses the `docx` npm package to generate a .docx file client-side
 *        with headings, paragraphs, code blocks, and agent metadata.
 */

import {
  Document, Packer,
  Paragraph, TextRun, HeadingLevel, AlignmentType,
  BorderStyle, Table, TableRow, TableCell, WidthType,
  ShadingType, convertInchesToTwip,
} from "docx";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ExportMessage {
  role: "user" | "assistant";
  content: string;
  aiId?: string;
  timestamp?: Date;
}

export interface ExportOptions {
  title?: string;
  workspaceName?: string;
  agentLabel?: string;
  messages: ExportMessage[];
}

// ── Agent display names ────────────────────────────────────────────────────────
const AI_LABELS: Record<string, string> = {
  __auto__:        "Auto",
  pollinations:    "Pollinations",
  llm7:            "LLM7",
  chatgpt:         "ChatGPT",
};

function agentLabel(aiId?: string): string {
  return aiId ? (AI_LABELS[aiId] ?? aiId) : "Assistant";
}

function fmtDate(d?: Date): string {
  if (!d) return "";
  return d.toLocaleString(undefined, {
    month: "short", day: "numeric", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

// ── Simple markdown → plain text stripper (for Word body paragraphs) ──────────
function stripMarkdown(md: string): string {
  return md
    .replace(/```[\s\S]*?```/g, "[code block]")   // collapse code blocks to placeholder
    .replace(/`([^`]+)`/g, "$1")                  // inline code
    .replace(/^#{1,6}\s+/gm, "")                  // headings
    .replace(/\*\*([^*]+)\*\*/g, "$1")            // bold
    .replace(/\*([^*]+)\*/g, "$1")                // italic
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "[image]")  // images
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")      // links → text
    .replace(/^[-*+]\s+/gm, "• ")                 // ul bullets
    .replace(/^\d+\.\s+/gm, "")                   // ol numbers
    .replace(/^>\s+/gm, "")                        // blockquotes
    .replace(/---+/g, "")                          // hr
    .trim();
}

// ── Code-block extractor — splits a message into text + code segments ─────────
interface Segment { type: "text" | "code"; text: string; lang?: string }

function splitSegments(content: string): Segment[] {
  const segs: Segment[] = [];
  const regex = /```(\w*)\n?([\s\S]*?)```/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = regex.exec(content)) !== null) {
    if (m.index > last) segs.push({ type: "text", text: content.slice(last, m.index) });
    segs.push({ type: "code", lang: m[1] || "text", text: m[2].trimEnd() });
    last = m.index + m[0].length;
  }
  if (last < content.length) segs.push({ type: "text", text: content.slice(last) });
  return segs;
}

// ─────────────────────────────────────────────────────────────────────────────
// PDF export — print-window approach
// ─────────────────────────────────────────────────────────────────────────────

/** Minimal but comprehensive syntax-coloured CSS for code blocks */
const PRINT_CSS = `
  :root { --bg: #f8f9fa; --fg: #1a1a2e; --border: #dee2e6; --code-bg: #1a1a2e; --code-fg: #d4d4e8; --user-bg: #f3f0ff; --user-border: #7c3aed; --ai-bg: #f0f9ff; --ai-border: #0284c7; --accent: #7c3aed; }
  @media (prefers-color-scheme: dark) { :root { --bg: #0d0d12; --fg: #d4d4e8; --border: #1e1e2e; --code-bg: #0a0a0f; --code-fg: #d4d4e8; --user-bg: #1a1040; --user-border: #7c3aed; --ai-bg: #0a1520; --ai-border: #0284c7; } }

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', system-ui, -apple-system, sans-serif; font-size: 13px; line-height: 1.6; background: var(--bg); color: var(--fg); padding: 24px; max-width: 800px; margin: 0 auto; }
  .export-header { border-bottom: 2px solid var(--accent); padding-bottom: 12px; margin-bottom: 24px; }
  .export-title { font-size: 22px; font-weight: 700; color: var(--accent); }
  .export-meta { font-size: 11px; color: #888; margin-top: 4px; }
  .message { margin-bottom: 16px; border-radius: 10px; overflow: hidden; border: 1px solid var(--border); page-break-inside: avoid; }
  .message-header { display: flex; justify-content: space-between; align-items: center; padding: 6px 12px; font-size: 11px; font-weight: 600; }
  .message.user .message-header { background: var(--user-border); color: #fff; }
  .message.assistant .message-header { background: var(--ai-border); color: #fff; }
  .message-body { padding: 10px 12px; background: var(--bg); }

  /* Markdown elements */
  .message-body p { margin-bottom: 8px; }
  .message-body h1, .message-body h2, .message-body h3 { font-weight: 700; margin: 12px 0 6px; }
  .message-body h1 { font-size: 18px; } .message-body h2 { font-size: 16px; } .message-body h3 { font-size: 14px; }
  .message-body ul, .message-body ol { margin: 6px 0 6px 20px; }
  .message-body li { margin-bottom: 3px; }
  .message-body blockquote { border-left: 3px solid var(--accent); padding-left: 10px; color: #666; margin: 8px 0; }
  .message-body strong { font-weight: 700; }
  .message-body em { font-style: italic; }
  .message-body code { font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace; background: var(--code-bg); color: var(--code-fg); padding: 1px 4px; border-radius: 3px; font-size: 12px; }
  .message-body pre { background: var(--code-bg); color: var(--code-fg); padding: 12px; border-radius: 6px; overflow-x: auto; margin: 8px 0; font-size: 12px; font-family: 'JetBrains Mono', 'Cascadia Code', 'Fira Code', monospace; line-height: 1.5; }
  .message-body pre code { background: none; padding: 0; }
  .lang-label { font-size: 10px; color: #999; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 2px; }
  hr { border: none; border-top: 1px solid var(--border); margin: 16px 0; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0; font-size: 12px; }
  th, td { border: 1px solid var(--border); padding: 5px 8px; }
  th { background: var(--code-bg); color: var(--code-fg); font-weight: 600; }

  @media print {
    body { padding: 12px; }
    .message { page-break-inside: avoid; }
    @page { margin: 1cm; }
  }
`;

/** Very lightweight markdown → HTML converter for the print window */
function markdownToHtml(md: string): string {
  return md
    // Escape HTML in non-code contexts (applied after code block extraction)
    .replace(/```(\w*)\n?([\s\S]*?)```/g, (_m, lang: string, code: string) => {
      const escaped = code
        .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<div class="lang-label">${lang || "code"}</div><pre><code>${escaped}</code></pre>`;
    })
    .replace(/`([^`\n]+)`/g, (_m, code: string) => {
      const escaped = code.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      return `<code>${escaped}</code>`;
    })
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\*([^*\n]+)\*/g, "<em>$1</em>")
    .replace(/^#{3}\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^#{2}\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#{1}\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/^>\s+(.+)$/gm, "<blockquote>$1</blockquote>")
    .replace(/^[-*+]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
    .replace(/^---+$/gm, "<hr>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n\n/g, "</p><p>")
    .replace(/^(?!<[a-zA-Z/])(.+)$/gm, (m) => m.trim() ? m : "");
}

export function exportChatAsPdf(opts: ExportOptions): void {
  const { title = "Vesper Chat Export", workspaceName, agentLabel: aLabel, messages } = opts;
  const now = new Date();

  const messagesHtml = messages.map(msg => {
    const isUser = msg.role === "user";
    const sender = isUser ? "You" : agentLabel(msg.aiId) + (aLabel ? ` · ${aLabel}` : "");
    const ts = msg.timestamp ? fmtDate(msg.timestamp) : fmtDate(now);
    const bodyHtml = markdownToHtml(msg.content);
    return `
      <div class="message ${isUser ? "user" : "assistant"}">
        <div class="message-header">
          <span>${sender}</span>
          <span>${ts}</span>
        </div>
        <div class="message-body"><p>${bodyHtml}</p></div>
      </div>`;
  }).join("\n");

  const html = `<!DOCTYPE html><html lang="en"><head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title}</title>
    <style>${PRINT_CSS}</style>
  </head><body>
    <div class="export-header">
      <div class="export-title">${title}</div>
      <div class="export-meta">
        ${workspaceName ? `Workspace: ${workspaceName} &nbsp;·&nbsp; ` : ""}
        ${messages.length} message${messages.length === 1 ? "" : "s"}
        &nbsp;·&nbsp; Exported ${fmtDate(now)}
      </div>
    </div>
    ${messagesHtml}
  </body></html>`;

  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url  = URL.createObjectURL(blob);

  const win = window.open(url, "_blank", "width=900,height=700,menubar=no,toolbar=no");
  if (win) {
    win.addEventListener("load", () => {
      setTimeout(() => {
        win.print();
        // Clean up blob URL after a short delay
        setTimeout(() => URL.revokeObjectURL(url), 5_000);
      }, 400);
    });
  } else {
    // Pop-up blocked — open the URL directly so user can print manually
    window.location.href = url;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Word (.docx) export — client-side via docx package
// ─────────────────────────────────────────────────────────────────────────────

/** Convert a text segment into docx Paragraph(s) */
function textToParagraphs(text: string): Paragraph[] {
  return text
    .split("\n")
    .filter(line => line.trim())
    .map(line => {
      // Heading detection
      const h1 = line.match(/^# (.+)/);  if (h1) return new Paragraph({ text: h1[1],  heading: HeadingLevel.HEADING_1 });
      const h2 = line.match(/^## (.+)/); if (h2) return new Paragraph({ text: h2[1],  heading: HeadingLevel.HEADING_2 });
      const h3 = line.match(/^### (.+)/);if (h3) return new Paragraph({ text: h3[1],  heading: HeadingLevel.HEADING_3 });

      // Bold / italic inline markup → TextRuns
      const runs: TextRun[] = [];
      const inline = /(\*\*([^*]+)\*\*|\*([^*]+)\*|`([^`]+)`|([^*`]+))/g;
      let m: RegExpExecArray | null;
      while ((m = inline.exec(line)) !== null) {
        if (m[2]) runs.push(new TextRun({ text: m[2], bold: true }));
        else if (m[3]) runs.push(new TextRun({ text: m[3], italics: true }));
        else if (m[4]) runs.push(new TextRun({ text: m[4], font: "Courier New", size: 20 }));
        else if (m[5]) runs.push(new TextRun({ text: m[5] }));
      }
      return new Paragraph({ children: runs.length > 0 ? runs : [new TextRun({ text: stripMarkdown(line) })] });
    });
}

/** Convert a code segment to a shaded code-block paragraph */
function codeBlock(code: string, lang?: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  if (lang) {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: lang.toUpperCase(), color: "888888", size: 16, font: "Courier New" })],
    }));
  }
  code.split("\n").forEach(line => {
    paragraphs.push(new Paragraph({
      children: [new TextRun({ text: line || " ", font: "Courier New", size: 18, color: "D4D4E8" })],
      shading: { type: ShadingType.SOLID, color: "1A1A2E", fill: "1A1A2E" },
      indent: { left: convertInchesToTwip(0.2), right: convertInchesToTwip(0.2) },
    }));
  });
  return paragraphs;
}

export async function exportChatAsDocx(opts: ExportOptions): Promise<void> {
  const { title = "Vesper Chat Export", workspaceName, messages } = opts;
  const now = new Date();

  const children: Paragraph[] = [
    // ── Document title ──────────────────────────────────────────────────────
    new Paragraph({
      text: title,
      heading: HeadingLevel.TITLE,
      alignment: AlignmentType.LEFT,
    }),
    new Paragraph({
      children: [
        new TextRun({ text: `Exported: ${fmtDate(now)}`, color: "888888", size: 18 }),
        ...(workspaceName ? [new TextRun({ text: `  ·  Workspace: ${workspaceName}`, color: "888888", size: 18 })] : []),
        new TextRun({ text: `  ·  ${messages.length} messages`, color: "888888", size: 18 }),
      ],
    }),
    new Paragraph({ text: "" }),
  ];

  for (const msg of messages) {
    const isUser = msg.role === "user";
    const sender = isUser ? "You" : agentLabel(msg.aiId);
    const ts     = msg.timestamp ? fmtDate(msg.timestamp) : "";

    // ── Message header ────────────────────────────────────────────────────
    children.push(new Paragraph({
      children: [
        new TextRun({ text: sender, bold: true, color: isUser ? "7C3AED" : "0284C7", size: 22 }),
        ...(ts ? [new TextRun({ text: `  ${ts}`, color: "888888", size: 18 })] : []),
      ],
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 4, color: isUser ? "7C3AED" : "0284C7" },
      },
      spacing: { before: 200, after: 100 },
    }));

    // ── Message body — split into text / code segments ─────────────────
    const segs = splitSegments(msg.content);
    for (const seg of segs) {
      if (seg.type === "code") {
        children.push(...codeBlock(seg.text, seg.lang));
      } else {
        children.push(...textToParagraphs(seg.text));
      }
    }

    // Spacer
    children.push(new Paragraph({ text: "" }));
  }

  const doc = new Document({
    creator: "Vesper IDE by Skinopro Tech Solutions",
    title,
    description: `Chat export — ${messages.length} messages`,
    sections: [{ properties: {}, children }],
  });

  const blob  = await Packer.toBlob(doc);
  const url   = URL.createObjectURL(blob);
  const a     = document.createElement("a");
  const slug  = title.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
  a.href      = url;
  a.download  = `${slug}-${now.toISOString().slice(0, 10)}.docx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 5_000);
}
