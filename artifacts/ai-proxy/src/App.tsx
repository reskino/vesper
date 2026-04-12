import { Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { IDELayout } from "@/components/layout/ide-layout";
import { IDEProvider } from "@/contexts/ide-context";
import { AgentProvider } from "@/contexts/agent-context";
import { WorkspaceProvider } from "@/contexts/workspace-context";
import { AutonomousProvider } from "@/contexts/autonomous-context";

const queryClient = new QueryClient();

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <AgentProvider>
            <WorkspaceProvider>
              <IDEProvider>
                <AutonomousProvider>
                  <IDELayout />
                </AutonomousProvider>
              </IDEProvider>
            </WorkspaceProvider>
          </AgentProvider>
          <Toaster />
        </WouterRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
