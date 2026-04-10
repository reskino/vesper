import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 flex flex-col min-h-0 overflow-hidden relative">
        <div className="flex-1 flex flex-col min-h-0 overflow-hidden sm:pb-0" style={{ paddingBottom: 'env(safe-area-inset-bottom, 0px)' }}>
          {children}
        </div>
        {/* Mobile nav spacer — pushes content above the fixed bottom nav */}
        <div className="sm:hidden shrink-0 h-[60px]" />
      </main>
    </div>
  );
}
