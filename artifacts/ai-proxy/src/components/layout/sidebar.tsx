import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { MessageSquare, Code2, TerminalSquare, Bot, Database, History, Moon, Sun, Zap } from "lucide-react";

const NAV = [
  { href: "/",         label: "Chat",     icon: MessageSquare },
  { href: "/editor",   label: "Editor",   icon: Code2 },
  { href: "/terminal", label: "Terminal", icon: TerminalSquare },
  { href: "/agent",    label: "Agent",    icon: Bot },
  { href: "/sessions", label: "Sessions", icon: Database },
  { href: "/history",  label: "History",  icon: History },
];

export function Sidebar() {
  const [location] = useLocation();
  const [dark, setDark] = useState(true);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
  };

  return (
    <>
      {/* ── Desktop sidebar ──────────────────────────── */}
      <aside className="hidden sm:flex w-60 shrink-0 flex-col border-r border-border bg-sidebar h-screen">
        <div className="px-4 pt-5 pb-4 border-b border-border/50">
          <div className="flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-xl bg-primary flex items-center justify-center shrink-0">
              <Zap className="h-4 w-4 text-primary-foreground" />
            </div>
            <div>
              <p className="font-bold text-sm text-sidebar-foreground">AI Proxy</p>
              <p className="text-[10px] text-muted-foreground font-mono">v0.1.0</p>
            </div>
          </div>
        </div>

        <nav className="flex-1 p-2.5 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <div
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-xl cursor-pointer transition-all group
                    ${active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                  data-testid={`nav-${label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="text-sm font-medium">{label}</span>
                </div>
              </Link>
            );
          })}
        </nav>

        <div className="p-2.5 border-t border-border/50">
          <button
            onClick={toggleTheme}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl w-full text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all"
            data-testid="btn-theme-toggle"
          >
            {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            <span className="text-sm font-medium">{dark ? "Light mode" : "Dark mode"}</span>
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar/95 backdrop-blur-xl border-t border-border grid grid-cols-5">
        {NAV.slice(0, 5).map(({ href, label, icon: Icon }) => {
          const active = location === href;
          return (
            <Link key={href} href={href} className="col-span-1">
              <div className={`flex flex-col items-center justify-center gap-1 py-2.5 transition-colors ${
                active ? "text-primary" : "text-muted-foreground"
              }`}>
                <Icon className="h-5 w-5" />
                <span className="text-[9px] font-semibold tracking-wide">{label}</span>
              </div>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
