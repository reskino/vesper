import { useState, useEffect } from "react";
import { Link, useLocation } from "wouter";
import { Terminal, Database, History, Settings, Moon, Sun, Code, Bot, TerminalSquare } from "lucide-react";
import { Button } from "@/components/ui/button";

export function Sidebar() {
  const [location] = useLocation();
  const [theme, setTheme] = useState<"dark" | "light" | "system">("dark");

  useEffect(() => {
    const isDark = document.documentElement.classList.contains("dark");
    setTheme(isDark ? "dark" : "light");
  }, []);

  const toggleTheme = () => {
    const newTheme = theme === "dark" ? "light" : "dark";
    setTheme(newTheme);
    document.documentElement.classList.toggle("dark", newTheme === "dark");
  };

  const navItems = [
    { href: "/", label: "Chat", icon: Terminal },
    { href: "/editor", label: "Editor", icon: Code },
    { href: "/terminal", label: "Terminal", icon: TerminalSquare },
    { href: "/agent", label: "Agent", icon: Bot },
    { href: "/sessions", label: "Sessions", icon: Database },
    { href: "/history", label: "History", icon: History },
  ];

  return (
    <aside className="w-16 md:w-64 border-r border-border bg-sidebar h-screen flex flex-col justify-between hidden sm:flex shrink-0">
      <div className="py-4">
        <div className="px-4 mb-6 md:block hidden">
          <h2 className="text-lg font-bold tracking-tight text-sidebar-foreground">AI Proxy</h2>
          <p className="text-xs text-muted-foreground font-mono mt-1">v0.1.0</p>
        </div>
        <nav className="space-y-1 px-2">
          {navItems.map((item) => (
            <Link key={item.href} href={item.href}>
              <div
                className={`flex items-center px-3 py-2 md:py-2.5 rounded-md cursor-pointer transition-colors group ${
                  location === item.href
                    ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium shadow-sm"
                    : "text-muted-foreground hover:bg-sidebar-accent/50 hover:text-sidebar-foreground"
                }`}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className={`h-5 w-5 ${location === item.href ? "text-primary" : "text-muted-foreground group-hover:text-sidebar-foreground"}`} />
                <span className="ml-3 hidden md:block">{item.label}</span>
              </div>
            </Link>
          ))}
        </nav>
      </div>

      <div className="p-4 border-t border-border flex items-center justify-center md:justify-between">
        <Button variant="ghost" size="icon" onClick={toggleTheme} className="text-muted-foreground" data-testid="btn-theme-toggle">
          {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
        </Button>
        <Button variant="ghost" size="icon" className="hidden md:flex text-muted-foreground">
          <Settings className="h-5 w-5" />
        </Button>
      </div>
    </aside>
  );
}
