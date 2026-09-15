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

const OMP_TIMEOUT_MS = 10_000;
const SENSITIVE_STDERR_PATTERN =
  /(?:[a-z][a-z\d+.-]*:\/\/|www\.|\b(?:auth(?:orization)?|credential|key|password|secret|token)\b|(?:^|[?&#\s])(?:access|control|room|write)[_-]?(?:key|secret|token)=|\b[a-f\d]{16,}\b|\b[A-Za-z\d_-]{24,}\b)/iu;

async function runOmp(args: string[]): Promise<string> {
  const operation =
    args[1] === "list" ? "collab list" : args[1] === "link" ? "collab link" : "collab operation";
  let child: Bun.Subprocess<"ignore", "pipe", "pipe">;

  try {
    child = Bun.spawn(["omp", ...args], {
      stdout: "pipe",
      stderr: "pipe",
    });
  } catch {
    throw new Error(`OMP ${operation} failed to start`);
  }

  const completion = Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]).then(
    (result) => ({ completed: true as const, result }),
    () => ({ completed: true as const, result: null }),
  );
  let timeout: Timer | undefined;

  const outcome = await Promise.race([
    completion,
    new Promise<{ completed: false }>((resolve) => {
      timeout = setTimeout(() => resolve({ completed: false }), OMP_TIMEOUT_MS);
    }),
  ]);

  clearTimeout(timeout);

  if (!outcome.completed) {
    try {
      child.kill("SIGKILL");
    } catch {
      // The process may have exited between the timeout and termination attempt.
    }
    await completion;
    throw new Error(`OMP ${operation} timed out`);
  }

  if (!outcome.result) {
    throw new Error(`OMP ${operation} failed`);
  }

  const [stdout, stderr, exitCode] = outcome.result;
  if (exitCode !== 0) {
    const detail = stderr
      .trim()
      .replace(/\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07]*(?:\x07|\x1b\\))/gu, "")
      .replace(/[\u0000-\u001f\u007f-\u009f]/gu, "")
      .replace(/\s+/gu, " ");
    if (detail && !SENSITIVE_STDERR_PATTERN.test(detail)) {
      throw new Error(`OMP ${operation} failed: ${detail.slice(0, 500)}`);
    }
    throw new Error(`OMP ${operation} failed`);
  }

  return stdout.trim();
}

export async function getCurrentCollabHost(pid = process.pid): Promise<CollabHost | null> {
  const raw = await runOmp(["collab", "list", "--json"]);
  let payload: { hosts?: CollabHost[] };
  try {
    payload = JSON.parse(raw) as { hosts?: CollabHost[] };
  } catch {
    throw new Error("OMP collab list returned an invalid response");
  }
  return payload.hosts?.find((host) => host.pid === pid) ?? null;
}

export async function getCurrentCollabConnection(
  pid = process.pid,
): Promise<CollabHostConnection | null> {
  const host = await getCurrentCollabHost(pid);
  if (!host) return null;

  const raw = await runOmp(["collab", "link", host.instanceId, "--json"]);
  let link: { access?: "view" | "control"; url?: string };
  try {
    link = JSON.parse(raw) as { access?: "view" | "control"; url?: string };
  } catch {
    throw new Error("OMP collab link returned an invalid response");
  }

  if (!link.url) {
    throw new Error("OMP returned a collab host without a browser link");
  }

  return {
    host,
    access: link.access ?? "control",
    url: link.url,
  };
}
