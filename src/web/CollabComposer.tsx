import { Paperclip, Send, Square } from "lucide-react";
import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { CollabComposerProps } from "./collabTypes";

export function CollabComposer({
  disabled = false,
  placeholder = "Message OMP...",
  isStreaming = false,
  onSend,
  onAbort,
}: CollabComposerProps) {
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSending, setIsSending] = useState(false);
  const textareaId = useId();
  const feedbackId = useId();
  const trimmedDraft = draft.trim();
  const canSend = !disabled && !isStreaming && !isSending && trimmedDraft.length > 0;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;

    setIsSending(true);
    setFeedback("Sending message...");
    try {
      await onSend(trimmedDraft);
      setDraft("");
      setFeedback("Message sent.");
    } catch {
      setFeedback("Message could not be sent. Your draft was preserved.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key !== "Enter" || (!event.ctrlKey && !event.metaKey)) return;

    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleAbort() {
    if (disabled || !isStreaming || !onAbort || isSending) return;
    setIsSending(true);
    setFeedback("Requesting abort...");
    try {
      await onAbort();
      setFeedback("Abort requested.");
    } catch {
      setFeedback("Abort could not be requested.");
    } finally {
      setIsSending(false);
    }
  }

  return (
    <form className="composer" onSubmit={handleSubmit} aria-describedby={feedbackId}>
      <button
        className="composer-icon"
        type="button"
        aria-label="Attach file (not available)"
        disabled
      >
        <Paperclip size={18} aria-hidden="true" />
      </button>

      <label htmlFor={textareaId} style={{ position: "absolute", width: 1, height: 1, padding: 0, margin: -1, overflow: "hidden", clip: "rect(0, 0, 0, 0)", whiteSpace: "nowrap", border: 0 }}>
        Message to OMP
      </label>
      <textarea
        id={textareaId}
        value={draft}
        disabled={disabled || isSending}
        placeholder={placeholder}
        onChange={(event) => {
          setDraft(event.target.value);
          if (feedback) setFeedback("");
        }}
        onKeyDown={handleKeyDown}
      />

      <div id={feedbackId} className="composer-hint" role="status" aria-live="polite">
        {feedback || (disabled ? "Messaging unavailable" : "Ctrl/⌘ + Enter to send")}
      </div>

      {isStreaming ? (
        <button
          className="send-button"
          type="button"
          onClick={handleAbort}
          disabled={disabled || !onAbort || isSending}
          aria-label="Abort response"
        >
          <Square size={15} aria-hidden="true" />
        </button>
      ) : (
        <button className="send-button" type="submit" disabled={!canSend} aria-label="Send message">
          <Send size={17} aria-hidden="true" />
        </button>
      )}
    </form>
  );
}
