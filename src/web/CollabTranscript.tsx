import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { CollabTranscriptProps, SessionEntry } from "./collabTypes";
import {
  isRecord,
  asText,
  liveMessage,
  messageIdentity,
  NEAR_BOTTOM_PX,
  notices,
  prefersReducedMotion,
  scrollToBottom,
  toolActivities,
} from "./transcript-model";
import { Message, TranscriptEntry } from "./TranscriptEntry";

const WRAP_STYLE: React.CSSProperties = { overflowWrap: "anywhere", whiteSpace: "pre-wrap" };

function entryKey(entry: SessionEntry, index: number): string {
  return isRecord(entry) ? (asText(entry.id) ?? `entry-${index}`) : `entry-${index}`;
}

export function CollabTranscript({
  entries,
  events,
  status,
  welcomeTitle,
  isStreaming = false,
  queuedMessages = 0,
  scrollRef,
}: CollabTranscriptProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const stickyRef = useRef(true);
  const seenSignatureRef = useRef<string | null>(null);
  const [showJump, setShowJump] = useState(false);

  const safeEntries = useMemo(() => (Array.isArray(entries) ? entries : []), [entries]);
  const safeEvents = useMemo(() => (Array.isArray(events) ? events : []), [events]);
  const latestMessage = useMemo(() => liveMessage(safeEvents, safeEntries), [safeEntries, safeEvents]);
  const tools = useMemo(() => toolActivities(safeEvents, safeEntries), [safeEvents, safeEntries]);
  const latestNotices = useMemo(() => notices(safeEvents), [safeEvents]);

  // A cheap signature over visible content, so only genuine additions raise the jump affordance.
  const contentSignature = useMemo(
    () =>
      [
        safeEntries.length,
        latestMessage ? messageIdentity(latestMessage) : "",
        tools.map((tool) => `${tool.id}:${tool.status}:${tool.detail ?? ""}`).join("|"),
        latestNotices.map((notice) => `${notice.level}:${notice.message}`).join("|"),
        isStreaming ? `streaming:${queuedMessages}` : "settled",
      ].join(";"),
    [safeEntries, latestMessage, tools, latestNotices, isStreaming, queuedMessages]
  );

  useEffect(() => {
    const element = containerRef.current;
    const signature = contentSignature;
    const isNewContent = seenSignatureRef.current !== null && seenSignatureRef.current !== signature;
    seenSignatureRef.current = signature;
    if (!element) return;

    if (stickyRef.current) {
      scrollToBottom(element, !prefersReducedMotion());
      setShowJump(false);
    } else if (isNewContent) {
      setShowJump(true);
    }
  }, [contentSignature]);

  const setContainer = useCallback(
    (element: HTMLDivElement | null) => {
      containerRef.current = element;
      if (typeof scrollRef === "function") scrollRef(element);
      else if (scrollRef && typeof scrollRef === "object" && "current" in scrollRef) scrollRef.current = element;
    },
    [scrollRef]
  );

  function handleScroll() {
    const element = containerRef.current;
    if (!element) return;
    stickyRef.current = element.scrollHeight - element.scrollTop - element.clientHeight < NEAR_BOTTOM_PX;
    if (stickyRef.current) setShowJump(false);
  }

  function jumpToLatest() {
    const element = containerRef.current;
    if (!element) return;
    stickyRef.current = true;
    setShowJump(false);
    scrollToBottom(element, !prefersReducedMotion());
  }

  const stateMessage =
    status === "connecting" || status === "reconnecting"
      ? "Connecting to the OMP session…"
      : status === "error"
        ? "Connection error. Reconnect to try again."
        : status === "closed"
          ? "Connection closed."
          : status === "idle"
            ? "Waiting for an OMP session…"
            : null;
  const isEmpty = safeEntries.length === 0 && !latestMessage && tools.length === 0 && latestNotices.length === 0;

  return (
    <div
      ref={setContainer}
      onScroll={handleScroll}
      className="collab-transcript"
      role="log"
      aria-live="polite"
      aria-relevant="additions text"
    >
      {stateMessage && !isEmpty ? <p className="collab-connection-state">{stateMessage}</p> : null}
      {isEmpty ? (
        <div className="welcome-state">
          <div className="welcome-orb" aria-hidden="true">
            <span />
          </div>
          <p className="welcome-kicker">Your local AI workspace</p>
          <h2>
            Let&apos;s make something <em>remarkable</em>
            {welcomeTitle ? <> in {welcomeTitle}</> : null}.
          </h2>
          <p className="welcome-copy">{stateMessage ?? "Ask a question, shape an idea, or start building."}</p>
          <div className="welcome-capabilities" aria-label="Workspace capabilities">
            <span>Think</span>
            <i aria-hidden="true" />
            <span>Build</span>
            <i aria-hidden="true" />
            <span>Iterate</span>
          </div>
        </div>
      ) : null}
      {safeEntries.map((entry, index) => (
        <TranscriptEntry key={entryKey(entry, index)} entry={entry} />
      ))}
      {latestMessage ? <Message message={latestMessage} live /> : null}
      {tools.map((tool) => (
        <p key={tool.id} style={WRAP_STYLE} className={`collab-tool-activity ${tool.status}`}>
          {tool.name}: {tool.status}
          {tool.detail ? ` · ${tool.detail}` : ""}
        </p>
      ))}
      {latestNotices.map((notice, index) => (
        <p key={`notice-${index}`} style={WRAP_STYLE} className={`collab-notice ${notice.level}`}>
          {notice.message}
        </p>
      ))}
      {isStreaming ? (
        <div className="collab-working" role="status" aria-live="polite">
          <span className="working-mark" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </span>
          <span className="working-copy">
            <strong>OMP is working</strong>
            <small>
              {queuedMessages > 0
                ? `${queuedMessages} ${queuedMessages === 1 ? "message" : "messages"} queued`
                : "Thinking through your request"}
            </small>
          </span>
          <span className="working-ellipsis" aria-hidden="true">
            <i />
            <i />
            <i />
          </span>
        </div>
      ) : null}
      {showJump ? (
        <button
          type="button"
          className="jump-to-latest"
          aria-label="Jump to latest"
          title="Jump to latest"
          onClick={jumpToLatest}
        >
          <ArrowDown size={14} aria-hidden="true" />
          <span>Jump to latest</span>
        </button>
      ) : null}
    </div>
  );
}
