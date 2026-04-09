import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/app-layout";
import { Home } from "@/pages/home";
import { Sessions } from "@/pages/sessions";
import { History } from "@/pages/history";
import Editor from "@/pages/editor";
import TerminalPage from "@/pages/terminal";
import AgentPage from "@/pages/agent";
import HelpPage from "@/pages/help";

const queryClient = new QueryClient();

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Home} />
        <Route path="/editor" component={Editor} />
        <Route path="/terminal" component={TerminalPage} />
        <Route path="/agent" component={AgentPage} />
        <Route path="/sessions" component={Sessions} />
        <Route path="/history" component={History} />
        <Route path="/help" component={HelpPage} />
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
