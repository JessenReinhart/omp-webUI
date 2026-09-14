export interface CollabHost {
  instanceId: string;
  generation: number;
  pid: number;
  sessionId?: string;
  sessionName?: string;
  cwd?: string;
  model?: unknown;
  startedAt?: string | number;
  participants?: number;
  connected?: boolean;
  inputRequired?: boolean;
  access?: "view" | "control";
  [key: string]: unknown;
}

export interface CollabHostConnection {
  host: CollabHost;
  access: "view" | "control";
  url: string;
}

async function runOmp(args: string[]): Promise<string> {
  const child = Bun.spawn(["omp", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);

  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `omp ${args.join(" ")} exited with code ${exitCode}`);
  }

  return stdout.trim();
}

export async function getCurrentCollabHost(pid = process.pid): Promise<CollabHost | null> {
  const raw = await runOmp(["collab", "list", "--json"]);
  const payload = JSON.parse(raw) as { hosts?: CollabHost[] };
  return payload.hosts?.find((host) => host.pid === pid) ?? null;
}

export async function getCurrentCollabConnection(
  pid = process.pid,
): Promise<CollabHostConnection | null> {
  const host = await getCurrentCollabHost(pid);
  if (!host) return null;

  const raw = await runOmp(["collab", "link", host.instanceId, "--json"]);
  const link = JSON.parse(raw) as { access?: "view" | "control"; url?: string };

  if (!link.url) {
    throw new Error("OMP returned a collab host without a browser link");
  }

  return {
    host,
    access: link.access ?? "control",
    url: link.url,
  };
}
