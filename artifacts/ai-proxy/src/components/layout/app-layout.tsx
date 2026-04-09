import { Sidebar } from "./sidebar";

export function AppLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen w-full bg-background overflow-hidden font-sans">
      <Sidebar />
      <main className="flex-1 flex flex-col h-full overflow-hidden relative">
        {children}
      </main>
    </div>
  );
}
