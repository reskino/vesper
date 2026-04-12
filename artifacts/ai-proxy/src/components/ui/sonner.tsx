import { Toaster as Sonner } from "sonner"

const Toaster = (props: React.ComponentProps<typeof Sonner>) => (
  <Sonner
    theme="dark"
    position="bottom-right"
    gap={8}
    toastOptions={{
      duration: 3500,
      classNames: {
        toast:
          "group !bg-[#0f0f16] !border !border-[#1e1e2e] !text-foreground !shadow-2xl !rounded-xl !font-sans",
        title: "!text-[13px] !font-medium !text-foreground",
        description: "!text-[12px] !text-[#9898b8]",
        actionButton:
          "!bg-primary !text-white !text-[11px] !rounded-lg !px-3 !py-1.5 !font-medium",
        cancelButton:
          "!bg-[#141420] !text-[#9898b8] !text-[11px] !rounded-lg !px-3 !py-1.5",
        error:   "!border-red-500/30",
        success: "!border-emerald-500/20",
        warning: "!border-amber-500/20",
        info:    "!border-primary/20",
        loader:  "!text-primary",
        closeButton: "!bg-[#141420] !border-[#1e1e2e] !text-[#9898b8] hover:!text-foreground",
      },
    }}
    {...props}
  />
)

export { Toaster }
