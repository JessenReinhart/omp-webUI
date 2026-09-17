import { spawn } from "node:child_process";

function browserCommand(url: string): { command: string; args: string[] } {
  switch (process.platform) {
    case "win32":
      return { command: "cmd.exe", args: ["/c", "start", "", url] };
    case "darwin":
      return { command: "open", args: [url] };
    default:
      return { command: "xdg-open", args: [url] };
  }
}

/**
 * Open the authenticated loopback URL in the user's default browser.
 *
 * Browser launch failure is deliberately non-fatal: the caller can still show
 * the URL so the workspace remains reachable in headless/minimal environments.
 */
export async function openBrowser(url: string): Promise<boolean> {
  const { command, args } = browserCommand(url);

  return await new Promise<boolean>((resolve) => {
    try {
      const child = spawn(command, args, {
        detached: true,
        stdio: "ignore",
        windowsHide: true,
      });

      let settled = false;
      const finish = (opened: boolean) => {
        if (settled) return;
        settled = true;
        resolve(opened);
      };

      child.once("spawn", () => {
        child.unref();
        finish(true);
      });
      child.once("error", () => finish(false));
    } catch {
      resolve(false);
    }
  });
}
