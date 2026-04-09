import { useState } from "react";
import {
  BookOpen, MessageSquare, Code2, TerminalSquare, Bot,
  Database, History, Github, ChevronDown, ChevronUp,
  Paperclip, Upload, FolderOpen, Cpu, Send, RefreshCw,
  LogIn, Globe, Zap, Shield, Layers, Plus,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { VesperLogo } from "@/components/vesper-logo";

// ── Accordion section ─────────────────────────────────────────────────────────
function Section({
  icon: Icon,
  title,
  color,
  children,
  defaultOpen = false,
}: {
  icon: React.ElementType;
  title: string;
  color: string;
  children: React.ReactNode;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-2xl border border-border overflow-hidden">
      <button
        className="w-full flex items-center gap-3 px-5 py-4 bg-card hover:bg-muted/40 transition-colors text-left"
        onClick={() => setOpen(o => !o)}
      >
        <span className={`h-8 w-8 rounded-xl flex items-center justify-center shrink-0 ${color}`}>
          <Icon className="h-4 w-4" />
        </span>
        <span className="flex-1 text-sm font-semibold text-foreground">{title}</span>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground shrink-0" /> : <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 pt-3 bg-card border-t border-border/50 space-y-3 text-sm text-muted-foreground leading-relaxed">
          {children}
        </div>
      )}
    </div>
  );
}

// ── Step badge ────────────────────────────────────────────────────────────────
function Step({ n, text }: { n: number; text: string }) {
  return (
    <div className="flex items-start gap-3">
      <span className="h-5 w-5 rounded-full bg-primary/15 text-primary text-[10px] font-bold flex items-center justify-center shrink-0 mt-0.5">
        {n}
      </span>
      <p>{text}</p>
    </div>
  );
}

// ── Tip box ───────────────────────────────────────────────────────────────────
function Tip({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2 bg-primary/5 border border-primary/15 rounded-xl px-4 py-3 text-xs text-foreground">
      <Zap className="h-3.5 w-3.5 text-primary shrink-0 mt-0.5" />
      <span>{children}</span>
    </div>
  );
}

// ── Key shortcut badge ────────────────────────────────────────────────────────
function Key({ k }: { k: string }) {
  return (
    <kbd className="inline-flex items-center px-2 py-0.5 rounded-md bg-muted border border-border text-[11px] font-mono text-foreground">
      {k}
    </kbd>
  );
}

// ── Main component ────────────────────────────────────────────────────────────
export default function HelpPage() {
  return (
    <ScrollArea className="h-full">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6 pb-24 sm:pb-8">

        {/* Hero */}
        <div className="text-center py-6 space-y-3">
          <div className="flex justify-center">
            <VesperLogo size={64} />
          </div>
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Vesper User Manual</h1>
            <p className="text-sm text-muted-foreground mt-1">by Skinopro Tech Solutions</p>
          </div>
          <p className="text-sm text-muted-foreground max-w-md mx-auto">
            Everything you need to know — from why we built this to how every feature works.
          </p>
        </div>

        {/* Why we built this */}
        <div className="rounded-2xl bg-gradient-to-br from-primary/10 to-primary/5 border border-primary/20 p-6 space-y-3">
          <div className="flex items-center gap-2.5">
            <Globe className="h-5 w-5 text-primary" />
            <h2 className="font-bold text-base text-foreground">Why Vesper Exists</h2>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every major AI — ChatGPT, Grok, Claude — has its own website, its own quirks, and its own
            subscription. Developers end up with five browser tabs open, copy-pasting the same prompt
            into each one, trying to figure out which AI gives the best answer for their specific problem.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            <strong className="text-foreground">Skinopro Tech Solutions built Vesper</strong> to solve this.
            Instead of managing multiple tabs and subscriptions, Vesper acts as a universal proxy — one
            clean interface that routes your coding prompts directly to whichever AI you choose, using
            your existing accounts via browser automation. No extra API costs. No tab switching. Just one
            tool that talks to all of them.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed">
            Vesper also goes beyond just chatting. It includes a full code editor, an integrated terminal,
            a file browser, an autonomous coding agent, and GitHub integration — so it can genuinely replace
            your development workflow, not just answer questions.
          </p>
          <div className="grid grid-cols-3 gap-3 pt-1">
            {[
              { icon: Zap, label: "One interface", sub: "All 3 AIs" },
              { icon: Shield, label: "Your accounts", sub: "No extra cost" },
              { icon: Layers, label: "Full IDE", sub: "Built-in tools" },
            ].map(({ icon: Icon, label, sub }) => (
              <div key={label} className="bg-background/60 rounded-xl p-3 text-center border border-border/50">
                <Icon className="h-4 w-4 text-primary mx-auto mb-1.5" />
                <p className="text-xs font-semibold text-foreground">{label}</p>
                <p className="text-[10px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Getting started */}
        <Section icon={LogIn} title="Getting Started — Sessions" color="bg-emerald-500/15 text-emerald-500" defaultOpen>
          <p>
            Before you can chat, Vesper needs a browser session logged into each AI service.
            A session is just a saved login — Vesper uses browser automation behind the scenes to
            talk to ChatGPT, Grok, and Claude on your behalf.
          </p>
          <div className="space-y-2">
            <Step n={1} text='Go to the Sessions page from the sidebar (or bottom nav on mobile).' />
            <Step n={2} text='Tap "Create Session" next to the AI you want to use (e.g. ChatGPT).' />
            <Step n={3} text='A headless browser will open and load the AI website. Log in as you normally would.' />
            <Step n={4} text='Once logged in, the session is saved. You will see a green dot next to that AI in the Chat panel.' />
          </div>
          <Tip>You only need to create a session once per AI. Sessions persist across restarts unless you delete them.</Tip>
          <p>
            The coloured dot next to each AI name tells you its status:
          </p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-emerald-500" /> <span>Green — session active, ready to chat</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-amber-500" /> <span>Amber — no session yet, needs login</span></div>
            <div className="flex items-center gap-2"><span className="h-2 w-2 rounded-full bg-red-500" /> <span>Red — AI service unreachable</span></div>
          </div>
        </Section>

        {/* Chat */}
        <Section icon={MessageSquare} title="Chat — Talking to the AI" color="bg-blue-500/15 text-blue-500">
          <p>
            The Chat page is your main workspace. On the left you see the three AI options — ChatGPT,
            Grok, and Claude. Click one to select it as the active AI for your conversation.
          </p>

          <p className="font-medium text-foreground">Sending a message</p>
          <div className="space-y-2">
            <Step n={1} text="Select an AI from the left panel (or tap the AI name in the mobile header)." />
            <Step n={2} text="Type your coding question or prompt in the message box at the bottom." />
            <Step n={3} text="Press Enter or tap the blue send button to submit." />
          </div>
          <Tip>Press <Key k="Shift + Enter" /> to add a new line without sending.</Tip>

          <p className="font-medium text-foreground">Switching models</p>
          <p>
            Each AI has multiple model variants. You can see the current model in the badge button
            next to the AI name (e.g. <Key k="GPT-4o ▼" />). Click that badge to expand the model
            list and pick a different one.
          </p>
          <div className="grid grid-cols-1 gap-1.5 text-xs">
            <div className="flex gap-2"><span className="font-semibold text-foreground w-28 shrink-0">ChatGPT</span><span>GPT-4o, GPT-4o mini, GPT-4, o1, o3-mini</span></div>
            <div className="flex gap-2"><span className="font-semibold text-foreground w-28 shrink-0">Grok</span><span>Grok 3, Grok 2</span></div>
            <div className="flex gap-2"><span className="font-semibold text-foreground w-28 shrink-0">Claude</span><span>Claude 3.7 Sonnet, Claude 3.5 Sonnet, Claude 3 Opus</span></div>
          </div>

          <p className="font-medium text-foreground">Regenerating a response</p>
          <p>
            If you are not happy with an answer, click the <RefreshCw className="inline h-3.5 w-3.5" /> regenerate button
            (appears after the first message). It resends your last prompt to get a fresh response.
          </p>

          <p className="font-medium text-foreground">Starting a new chat</p>
          <p>
            Click the <Plus className="inline h-3.5 w-3.5" /> icon in the top-right of the Models panel to clear the
            current conversation and start fresh. Your history is still saved in the History page.
          </p>
        </Section>

        {/* File attachment */}
        <Section icon={Paperclip} title="Attaching Files to a Message" color="bg-violet-500/15 text-violet-500">
          <p>
            You can give the AI extra context by attaching a file. Click the <strong>+</strong> button
            in the bottom-left of the chat input to choose how to attach:
          </p>
          <div className="space-y-2.5">
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border">
              <Upload className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground text-xs">Upload a file</p>
                <p>Opens your device's native file picker. The file is read into memory and sent as context alongside your next message. Supports most code and text file types.</p>
              </div>
            </div>
            <div className="flex items-start gap-3 p-3 rounded-xl bg-muted/40 border border-border">
              <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-foreground text-xs">From workspace</p>
                <p>Opens a tree browser showing all files in your project directory. Click any file to attach it. The server reads the file directly — no uploading needed.</p>
              </div>
            </div>
          </div>
          <p>
            Once attached, a badge showing the filename appears above the message box. Click the
            <strong> × </strong> on the badge to remove it before sending. The file is only included
            for one message — it does not persist to future messages automatically.
          </p>
          <Tip>Attach a file and ask things like "explain this code", "find the bug", or "rewrite this function to be more efficient".</Tip>
        </Section>

        {/* Editor */}
        <Section icon={Code2} title="Editor — Browse & Edit Files" color="bg-yellow-500/15 text-yellow-500">
          <p>
            The Editor page gives you a full development environment inside Vesper.
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <FolderOpen className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <p><strong className="text-foreground">File browser</strong> — the left panel shows your entire project tree. Click any file to open it in the editor.</p>
            </div>
            <div className="flex items-start gap-2">
              <Code2 className="h-4 w-4 shrink-0 mt-0.5 text-muted-foreground" />
              <p><strong className="text-foreground">Code editor</strong> — syntax-highlighted editing for all common languages. Changes are saved directly to the file on the server.</p>
            </div>
          </div>
          <Tip>Open a file in the editor and then use "From workspace" in Chat to send it to the AI for a code review without leaving the app.</Tip>
        </Section>

        {/* Terminal */}
        <Section icon={TerminalSquare} title="Terminal — Run Commands" color="bg-orange-500/15 text-orange-500">
          <p>
            The Terminal page gives you a real command-line shell running on the server. You can:
          </p>
          <ul className="space-y-1.5 list-none">
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Run your project (<Key k="npm run dev" />, <Key k="python main.py" />, etc.)</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Install packages (<Key k="npm install" />, <Key k="pip install" />)</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Run tests, git commands, or any shell script</li>
            <li className="flex items-center gap-2"><span className="text-primary">→</span> Navigate directories and inspect files</li>
          </ul>
          <Tip>Use <Key k="Ctrl + C" /> to stop a running process inside the terminal.</Tip>
        </Section>

        {/* Agent */}
        <Section icon={Bot} title="Agent — Autonomous Coding" color="bg-pink-500/15 text-pink-500">
          <p>
            The Agent page is Vesper's most powerful feature. Instead of you asking one question at a time,
            the Agent can take a task description and work through it step by step — reading files,
            writing code, running commands, and iterating — all on its own.
          </p>
          <div className="space-y-2">
            <Step n={1} text='Go to the Agent page and describe what you want built or fixed.' />
            <Step n={2} text='The Agent breaks the task into steps and starts executing them autonomously.' />
            <Step n={3} text='Watch the live log to see exactly what the Agent is doing at each step.' />
            <Step n={4} text='When it is done, review the changes in the Editor or Terminal.' />
          </div>
          <Tip>Best for tasks like "add a login page to my React app" or "fix the failing tests in my Python project" — things that require multiple files and steps.</Tip>
        </Section>

        {/* Sessions */}
        <Section icon={Database} title="Sessions — Managing Logins" color="bg-teal-500/15 text-teal-500">
          <p>
            The Sessions page is where you manage your AI browser logins. Each AI (ChatGPT, Grok, Claude)
            needs its own session to work.
          </p>
          <div className="space-y-2">
            <div className="flex items-start gap-2">
              <span className="text-primary font-bold shrink-0">+</span>
              <p><strong className="text-foreground">Create session</strong> — opens a browser window to the AI website so you can log in. Once done, the session is saved automatically.</p>
            </div>
            <div className="flex items-start gap-2">
              <span className="text-red-400 font-bold shrink-0">×</span>
              <p><strong className="text-foreground">Delete session</strong> — removes the saved login. You will need to log in again to use that AI.</p>
            </div>
          </div>
          <Tip>If an AI stops responding or gives errors, try deleting its session and creating a new one — this refreshes the login cookies.</Tip>
        </Section>

        {/* History */}
        <Section icon={History} title="History — Past Conversations" color="bg-indigo-500/15 text-indigo-500">
          <p>
            The History page stores all your past conversations with the AI, organised by date and AI model.
            You can scroll back through previous answers, review code the AI wrote, or pick up a
            conversation where you left off.
          </p>
          <Tip>History is stored locally on the server — it persists across sessions and restarts.</Tip>
        </Section>

        {/* GitHub */}
        <Section icon={Github} title="GitHub Integration" color="bg-gray-500/15 text-gray-400">
          <p>
            Vesper has built-in Git and GitHub support so you can manage your code without leaving the app.
          </p>
          <div className="space-y-1.5">
            <div className="flex gap-2"><span className="text-primary font-mono text-xs shrink-0 pt-0.5">clone</span><span>Clone any GitHub repository directly into your workspace.</span></div>
            <div className="flex gap-2"><span className="text-primary font-mono text-xs shrink-0 pt-0.5">status</span><span>See which files have changed since your last commit.</span></div>
            <div className="flex gap-2"><span className="text-primary font-mono text-xs shrink-0 pt-0.5">pull</span><span>Pull the latest changes from the remote repository.</span></div>
            <div className="flex gap-2"><span className="text-primary font-mono text-xs shrink-0 pt-0.5">push</span><span>Commit and push your changes back to GitHub.</span></div>
          </div>
          <p>To enable push access, add your GitHub Personal Access Token (PAT) in the GitHub panel. Your PAT is stored locally and never sent anywhere except GitHub.</p>
          <Tip>Use the Agent to make code changes, then use GitHub integration to commit and push — a complete development loop without leaving Vesper.</Tip>
        </Section>

        {/* Tips */}
        <Section icon={Zap} title="Tips & Best Practices" color="bg-amber-500/15 text-amber-500">
          <div className="space-y-3">
            <Tip>Always create sessions first — no session means no AI responses, even if you have an account.</Tip>
            <Tip>When switching between ChatGPT models (GPT-4o vs o1), the model selection takes effect on your next message after the switch.</Tip>
            <Tip>Attach a file and ask "what does this code do?" for instant AI-powered code explanation — great for understanding unfamiliar codebases.</Tip>
            <Tip>Use the Terminal to run your app, then switch to Chat to ask the AI to fix any errors you see — paste the error message directly into the chat.</Tip>
            <Tip>If the AI stops responding mid-conversation, go to Sessions and check the green dot — the session may have expired.</Tip>
            <Tip>The Editor auto-saves when you switch files — no need to manually save.</Tip>
          </div>
        </Section>

        {/* Footer */}
        <div className="text-center py-4 text-xs text-muted-foreground">
          <p>Vesper by Skinopro Tech Solutions</p>
          <p className="mt-1 opacity-60">Built to make AI-powered development accessible to everyone.</p>
        </div>

      </div>
    </ScrollArea>
  );
}
