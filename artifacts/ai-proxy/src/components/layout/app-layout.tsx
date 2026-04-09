import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden relative pb-16 sm:pb-0">
        {children}
      </main>
    </div>
  );
}
