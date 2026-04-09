import { useListSessions, getListSessionsQueryKey, useCreateSession, useDeleteSession, useListAis, getListAisQueryKey } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { ExternalLink, Trash2, ShieldCheck, ShieldAlert, MonitorPlay } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";

export function Sessions() {
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: aisData, isLoading: isLoadingAis } = useListAis({
    query: { queryKey: getListAisQueryKey() }
  });

  const { data: sessionsData, isLoading: isLoadingSessions } = useListSessions({
    query: { queryKey: getListSessionsQueryKey() }
  });

  const createSession = useCreateSession();
  const deleteSession = useDeleteSession();

  const handleCreateSession = async (aiId: string) => {
    try {
      const result = await createSession.mutateAsync({
        data: { aiId }
      });
      if (result.success) {
        toast({
          title: "Browser opened",
          description: "Please log in to the AI service, then close the browser window to save the session.",
        });
        // We shouldn't invalidate immediately, ideally there's a webhook or we poll,
        // but for now we just invalidate after a bit or let user manually refresh
      }
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e.message || "Failed to create session",
      });
    }
  };

  const handleDeleteSession = async (aiId: string) => {
    try {
      await deleteSession.mutateAsync({ aiId });
      queryClient.invalidateQueries({ queryKey: getListSessionsQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListAisQueryKey() });
      toast({
        title: "Session deleted",
        description: "The authentication session was removed.",
      });
    } catch (e: any) {
      toast({
        variant: "destructive",
        title: "Error",
        description: e.message || "Failed to delete session",
      });
    }
  };

  if (isLoadingAis || isLoadingSessions) {
    return <div className="p-8 text-muted-foreground">Loading session state...</div>;
  }

  const ais = aisData?.ais || [];

  return (
    <div className="flex-1 overflow-auto p-6 lg:p-10 bg-[#0a0a0a]">
      <div className="max-w-5xl mx-auto space-y-8">
        <div>
          <h1 className="text-3xl font-bold tracking-tight text-gray-100">Session Management</h1>
          <p className="text-muted-foreground mt-2">
            Manage browser authentication sessions for each AI service. A valid session is required to proxy requests.
          </p>
        </div>

        <Alert className="bg-primary/10 text-primary border-primary/20">
          <MonitorPlay className="h-4 w-4" />
          <AlertTitle>How it works</AlertTitle>
          <AlertDescription>
            Clicking "Create Session" will open a visible browser window. Log in to your account normally, verify any captchas, then close the window. The proxy will save your cookies and localStorage to authenticate background requests.
          </AlertDescription>
        </Alert>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          {ais.map((ai) => {
            const hasSession = ai.hasSession;

            return (
              <Card key={ai.id} className="bg-[#111] border-[#222] text-gray-300">
                <CardHeader>
                  <div className="flex items-start justify-between">
                    <div>
                      <CardTitle className="text-xl font-bold text-gray-200">{ai.name}</CardTitle>
                      <CardDescription className="mt-1 font-mono text-xs">{ai.url}</CardDescription>
                    </div>
                    <div className={`px-2 py-1 rounded text-xs font-medium flex items-center gap-1 ${
                      hasSession ? 'bg-green-950 text-green-400' : 'bg-amber-950 text-amber-400'
                    }`}>
                      {hasSession ? <ShieldCheck className="w-3 h-3" /> : <ShieldAlert className="w-3 h-3" />}
                      {hasSession ? 'Authenticated' : 'No Session'}
                    </div>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="text-sm text-gray-400">
                    Status: {ai.isAvailable ? <span className="text-green-400">Service Reachable</span> : <span className="text-red-400">Service Unreachable</span>}
                  </div>
                </CardContent>
                <CardFooter className="flex justify-end gap-3 border-t border-[#222] pt-4">
                  {hasSession ? (
                    <Button 
                      variant="destructive" 
                      size="sm" 
                      onClick={() => handleDeleteSession(ai.id)}
                      disabled={deleteSession.isPending}
                    >
                      <Trash2 className="w-4 h-4 mr-2" />
                      Delete Session
                    </Button>
                  ) : (
                    <Button 
                      variant="default" 
                      size="sm" 
                      className="bg-primary hover:bg-primary/90 text-primary-foreground"
                      onClick={() => handleCreateSession(ai.id)}
                      disabled={createSession.isPending || !ai.isAvailable}
                    >
                      <ExternalLink className="w-4 h-4 mr-2" />
                      Create Session
                    </Button>
                  )}
                </CardFooter>
              </Card>
            );
          })}
        </div>
      </div>
    </div>
  );
}
