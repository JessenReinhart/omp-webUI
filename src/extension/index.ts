import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import { startWebUiServer, type WebUiServer } from "../host/server";

let server: WebUiServer | undefined;

export default function webUiExtension(pi: ExtensionAPI) {
  pi.setLabel("omp-webUI");

  pi.registerCommand("webui", {
    description: "Open the local omp-webUI for this OMP process",
    handler: async (args, ctx) => {
      const command = args.trim().toLowerCase();

      if (command === "stop") {
        server?.stop();
        server = undefined;
        ctx.ui.notify("omp-webUI stopped", "info");
        return;
      }

      if (!server) {
        try {
          server = await startWebUiServer();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          ctx.ui.notify(`omp-webUI failed to start: ${message}`, "error");
          return;
        }
      }

      ctx.ui.notify(`omp-webUI: ${server.url}`, "info");
    },
  });

  pi.on("session_shutdown", async () => {
    server?.stop();
    server = undefined;
  });
}
