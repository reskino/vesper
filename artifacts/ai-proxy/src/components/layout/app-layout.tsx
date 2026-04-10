import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden">
          {children}
        </div>
        {/* Mobile nav spacer — reserves space for the fixed bottom nav + safe area */}
        <div
          className="sm:hidden shrink-0"
          style={{ height: 'calc(60px + env(safe-area-inset-bottom, 0px))' }}
        />
      </main>
    </div>
  );
}
