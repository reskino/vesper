import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import {
  MessageSquare, Code2, TerminalSquare, Bot, Database,
  History, Moon, Sun, BookOpen, ChevronLeft, ChevronRight,
  PanelLeft,
} from "lucide-react";
import { VesperLogo } from "@/components/vesper-logo";

const NAV = [
  { href: "/",         label: "Chat",     icon: MessageSquare },
  { href: "/editor",   label: "Editor",   icon: Code2 },
  { href: "/terminal", label: "Terminal", icon: TerminalSquare },
  { href: "/agent",    label: "Agent",    icon: Bot },
  { href: "/sessions", label: "Sessions", icon: Database },
  { href: "/history",  label: "History",  icon: History },
  { href: "/help",     label: "Help",     icon: BookOpen },
];

export function Sidebar() {
  const [location] = useLocation();
  const [dark, setDark] = useState(true);
  const [collapsed, setCollapsed] = useState(false);

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
      <aside
        className={`hidden sm:flex shrink-0 flex-col border-r border-border bg-sidebar h-screen transition-all duration-200 ease-in-out
          ${collapsed ? "w-[60px]" : "w-56"}`}
      >
        {/* Logo row */}
        <div className={`flex items-center border-b border-border/50 h-14 px-3 ${collapsed ? "justify-center" : "gap-2.5 px-4"}`}>
          {collapsed ? (
            <VesperLogo size={30} />
          ) : (
            <>
              <VesperLogo size={30} />
              <div className="flex-1 min-w-0">
                <p className="font-bold text-sm text-sidebar-foreground tracking-tight truncate">Vesper</p>
                <p className="text-[10px] text-muted-foreground leading-tight truncate">by Skinopro Tech Solutions</p>
              </div>
            </>
          )}
        </div>

        {/* Nav items */}
        <nav className="flex-1 py-2 px-2 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = location === href;
            return (
              <Link key={href} href={href}>
                <div
                  title={collapsed ? label : undefined}
                  className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl cursor-pointer transition-all group relative
                    ${collapsed ? "justify-center" : ""}
                    ${active
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground"}`}
                  data-testid={`nav-${label.toLowerCase()}`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  {!collapsed && <span className="text-sm font-medium">{label}</span>}

                  {/* Tooltip when collapsed */}
                  {collapsed && (
                    <div className="absolute left-full ml-2 z-50 px-2 py-1 rounded-lg bg-popover border border-border text-sm font-medium text-popover-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 pointer-events-none transition-opacity shadow-md">
                      {label}
                    </div>
                  )}
                </div>
              </Link>
            );
          })}
        </nav>

        {/* Bottom controls */}
        <div className="p-2 border-t border-border/50 space-y-0.5">
          <button
            onClick={toggleTheme}
            title={collapsed ? (dark ? "Light mode" : "Dark mode") : undefined}
            className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl w-full text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all ${collapsed ? "justify-center" : ""}`}
            data-testid="btn-theme-toggle"
          >
            {dark ? <Sun className="h-4 w-4 shrink-0" /> : <Moon className="h-4 w-4 shrink-0" />}
            {!collapsed && <span className="text-sm font-medium">{dark ? "Light mode" : "Dark mode"}</span>}
          </button>

          <button
            onClick={() => setCollapsed(c => !c)}
            title={collapsed ? "Expand sidebar" : "Collapse sidebar"}
            className={`flex items-center gap-3 px-2.5 py-2.5 rounded-xl w-full text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-all ${collapsed ? "justify-center" : ""}`}
          >
            {collapsed ? <ChevronRight className="h-4 w-4 shrink-0" /> : <><ChevronLeft className="h-4 w-4 shrink-0" /><span className="text-sm font-medium">Collapse</span></>}
          </button>
        </div>
      </aside>

      {/* ── Mobile bottom nav ────────────────────────── */}
      <nav className="sm:hidden fixed bottom-0 left-0 right-0 z-50 bg-sidebar/95 backdrop-blur-xl border-t border-border grid grid-cols-5">
        {[NAV[0], NAV[1], NAV[3], NAV[4], NAV[6]].map(({ href, label, icon: Icon }) => {
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
