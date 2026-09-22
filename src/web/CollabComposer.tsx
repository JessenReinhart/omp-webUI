import { BrainCircuit, ClipboardPaste, Command, Cpu, FileImage, FileText, Paperclip, Search, Send, Sparkles, Square, WandSparkles, X } from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type ClipboardEvent, type FormEvent, type KeyboardEvent } from "react";
import type { CollabComposerProps, ComposerAttachment, WorkspaceAttachment } from "./collabTypes";
import type { CommandOption } from "./commandTypes";

const MAX_VISIBLE_COMMANDS = 9;
const LONG_PASTE_CHARACTERS = 1_200;
const LONG_PASTE_LINES = 20;
const MAX_PASTED_TEXT_CHARACTERS = 500_000;
const MAX_PASTED_IMAGES = 4;
const MAX_PASTED_IMAGE_BYTES = 10 * 1024 * 1024;
const PASTED_IMAGE_TYPES = new Set(["image/gif", "image/jpeg", "image/png", "image/webp"]);

function attachmentKey(attachment: ComposerAttachment): string {
  return "path" in attachment ? attachment.path : attachment.id;
}

function imageFileData(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = typeof reader.result === "string" ? reader.result : "";
      const comma = result.indexOf(",");
      if (comma < 0) reject(new Error("Could not read pasted image"));
      else resolve(result.slice(comma + 1));
    };
    reader.onerror = () => reject(new Error("Could not read pasted image"));
    reader.readAsDataURL(file);
  });
}

function commandValue(option: CommandOption): string {
  return option.value ?? `/${option.name}${option.argumentHint ? " " : ""}`;
}

function SourceIcon({ source }: Pick<CommandOption, "source">) {
  if (source === "skill") return <WandSparkles size={15} aria-hidden="true" />;
  if (source === "prompt") return <FileText size={15} aria-hidden="true" />;
  if (source === "model") return <Cpu size={15} aria-hidden="true" />;
  if (source === "thinking") return <BrainCircuit size={15} aria-hidden="true" />;
  return <Command size={15} aria-hidden="true" />;
}

export function CollabComposer({
  disabled = false,
  placeholder = "Message OMP...",
  isStreaming = false,
  commands = [],
  pendingAttachments,
  initialDraft,
  onSend,
  onCommand,
  onSearchFiles,
  onAbort,
}: CollabComposerProps) {
  const [draft, setDraft] = useState("");
  const [feedback, setFeedback] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [paletteDismissed, setPaletteDismissed] = useState(false);
  const [filePickerOpen, setFilePickerOpen] = useState(false);
  const [fileQuery, setFileQuery] = useState("");
  const [fileMatches, setFileMatches] = useState<WorkspaceAttachment[]>([]);
  const [searchingFiles, setSearchingFiles] = useState(false);
  const [attachments, setAttachments] = useState<ComposerAttachment[]>([]);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const textareaId = useId();
  const feedbackId = useId();
  const listboxId = useId();
  const trimmedDraft = draft.trim();
  const isCommandDraft = draft.startsWith("/") && !draft.includes("\n");
  const canSend = !disabled && !isSending && (trimmedDraft.length > 0 || attachments.length > 0) && (!isStreaming || isCommandDraft);

  useEffect(() => {
    if (!pendingAttachments || pendingAttachments.length === 0) return;
    setAttachments((current) => {
      const updated = [...current];
      for (const att of pendingAttachments) {
        if (!updated.some((item) => attachmentKey(item) === attachmentKey(att))) {
          updated.push(att);
        }
      }
      return updated.slice(0, 8);
    });
  }, [pendingAttachments]);

  useEffect(() => {
    if (initialDraft !== undefined && initialDraft !== null) {
      setDraft(initialDraft);
      textareaRef.current?.focus();
    }
  }, [initialDraft]);

  const visibleCommands = useMemo(() => {
    if (!isCommandDraft || paletteDismissed) return [];
    const rawNeedle = draft.slice(1).toLowerCase();
    const needle = rawNeedle.trim();
    const contextual = rawNeedle.startsWith("model ")
      ? commands.filter((option) => option.source === "model")
      : rawNeedle.startsWith("thinking ")
        ? commands.filter((option) => option.source === "thinking")
        : commands.filter((option) => option.source !== "model" && option.source !== "thinking");
    return contextual
      .filter((option) => {
        const value = commandValue(option).slice(1).toLowerCase();
        const searchable = `${option.name} ${option.description} ${option.source} ${value}`.toLowerCase();
        return !needle || searchable.includes(needle) || value.startsWith(needle);
      })
      .sort((left, right) => Number(right.active) - Number(left.active))
      .slice(0, MAX_VISIBLE_COMMANDS);
  }, [commands, draft, isCommandDraft, paletteDismissed]);
  const paletteOpen = visibleCommands.length > 0 && !filePickerOpen;
  const selected = visibleCommands[Math.min(activeIndex, Math.max(visibleCommands.length - 1, 0))];

  useEffect(() => {
    setActiveIndex(0);
  }, [draft]);

  useEffect(() => {
    if (!filePickerOpen || !onSearchFiles) return;
    let active = true;
    setSearchingFiles(true);
    const timer = window.setTimeout(() => {
      void onSearchFiles(fileQuery)
        .then((files) => {
          if (active) setFileMatches(files);
        })
        .catch(() => {
          if (active) setFileMatches([]);
        })
        .finally(() => {
          if (active) setSearchingFiles(false);
        });
    }, 120);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [filePickerOpen, fileQuery, onSearchFiles]);

  function addAttachment(file: ComposerAttachment) {
    setAttachments((current) => current.some((item) => attachmentKey(item) === attachmentKey(file)) ? current : [...current, file].slice(0, 8));
    setFilePickerOpen(false);
    setFileQuery("");
    textareaRef.current?.focus();
  }

  function handlePaste(event: ClipboardEvent<HTMLTextAreaElement>) {
    const imageFiles = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);

    if (imageFiles.length > 0) {
      event.preventDefault();
      const existingImages = attachments.filter((attachment) => attachment.kind === "pasted-image").length;
      const accepted = imageFiles
        .filter((file) => PASTED_IMAGE_TYPES.has(file.type) && file.size <= MAX_PASTED_IMAGE_BYTES)
        .slice(0, Math.max(0, MAX_PASTED_IMAGES - existingImages));
      if (accepted.length === 0) {
        setFeedback("Paste PNG, JPEG, GIF, or WebP images up to 10 MB.");
        return;
      }
      void Promise.all(accepted.map(async (file, index) => ({
        id: crypto.randomUUID(),
        name: `Pasted image ${existingImages + index + 1}`,
        kind: "pasted-image" as const,
        mimeType: file.type,
        data: await imageFileData(file),
      }))).then((images) => {
        setAttachments((current) => [...current, ...images].slice(0, 8));
        setFeedback(images.length === 1 ? "Image attached." : `${images.length} images attached.`);
      }).catch(() => setFeedback("The pasted image could not be read."));
      return;
    }

    const pastedText = event.clipboardData.getData("text/plain");
    if (pastedText.length < LONG_PASTE_CHARACTERS && pastedText.split(/\r?\n/).length < LONG_PASTE_LINES) return;
    event.preventDefault();
    if (pastedText.length > MAX_PASTED_TEXT_CHARACTERS) {
      setFeedback("Pasted text is too large. Keep it under 500,000 characters.");
      return;
    }
    const pasteNumber = attachments.filter((attachment) => attachment.kind === "paste").length + 1;
    setAttachments((current) => [...current, {
      id: crypto.randomUUID(),
      name: `Pasted text ${pasteNumber}`,
      kind: "paste" as const,
      text: pastedText,
    }].slice(0, 8));
    setFeedback(`Long paste attached · ${pastedText.length.toLocaleString()} characters.`);
  }

  function chooseCommand(option: CommandOption) {
    setDraft(commandValue(option));
    setPaletteDismissed(false);
    setFeedback("");
    window.requestAnimationFrame(() => {
      const textarea = textareaRef.current;
      if (!textarea) return;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    });
  }

  async function executeCommand(text: string) {
    setIsSending(true);
    setPaletteDismissed(true);
    setFeedback("Running command…");
    try {
      if (!onCommand) throw new Error("Commands are unavailable");
      const result = await onCommand(text);
      setFeedback(result || "Command completed.");
      setDraft("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Request failed. Your draft was preserved.");
    } finally {
      setIsSending(false);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canSend) return;
    if (isCommandDraft) {
      await executeCommand(trimmedDraft);
      return;
    }
    setIsSending(true);
    setPaletteDismissed(true);
    setFeedback("Sending message…");
    try {
      await onSend(trimmedDraft, attachments);
      setFeedback("Message sent.");
      setAttachments([]);
      setDraft("");
    } catch (error) {
      setFeedback(error instanceof Error ? error.message : "Request failed. Your draft was preserved.");
    } finally {
      setIsSending(false);
    }
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (paletteOpen && event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index) => (index + 1) % visibleCommands.length);
      return;
    }
    if (paletteOpen && event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index) => (index - 1 + visibleCommands.length) % visibleCommands.length);
      return;
    }
    if (paletteOpen && event.key === "Escape") {
      event.preventDefault();
      setPaletteDismissed(true);
      return;
    }
    if (paletteOpen && selected && event.key === "Tab") {
      event.preventDefault();
      chooseCommand(selected);
      return;
    }
    if (paletteOpen && selected && event.key === "Enter" && !event.shiftKey && trimmedDraft !== commandValue(selected).trim()) {
      event.preventDefault();
      if (selected.argumentHint) {
        chooseCommand(selected);
      } else if (canSend) {
        void executeCommand(commandValue(selected).trim());
      }
      return;
    }
    if (event.key !== "Enter" || event.shiftKey) return;
    event.preventDefault();
    event.currentTarget.form?.requestSubmit();
  }

  async function handleAbort() {
    if (disabled || !isStreaming || !onAbort || isSending) return;
    setIsSending(true);
    setFeedback("Requesting abort…");
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
    <div className="composer-dock">
      <form className={`composer${paletteOpen ? " has-command-palette" : ""}`} onSubmit={handleSubmit} aria-describedby={feedbackId}>
        {filePickerOpen ? (
          <div className="command-palette file-palette" role="dialog" aria-label="Attach a workspace file">
            <div className="command-palette-header">
              <span>Attach from workspace</span>
              <button className="file-picker-close" type="button" onClick={() => setFilePickerOpen(false)} aria-label="Close file picker">
                <X size={14} aria-hidden="true" />
              </button>
            </div>
            <label className="file-search">
              <Search size={14} aria-hidden="true" />
              <span className="visually-hidden">Search workspace files</span>
              <input autoFocus value={fileQuery} onChange={(event) => setFileQuery(event.target.value)} placeholder="Search files…" />
            </label>
            <div className="command-palette-list file-palette-list" role="listbox" aria-label="Workspace files">
              {fileMatches.map((file) => (
                <button key={file.path} className="command-option file-option" type="button" role="option" aria-selected={attachments.some((item) => "path" in item && item.path === file.path)} onClick={() => addAttachment(file)}>
                  <span className={`command-option-icon source-${file.kind}`}>
                    {file.kind === "image" ? <FileImage size={15} aria-hidden="true" /> : <FileText size={15} aria-hidden="true" />}
                  </span>
                  <span className="command-option-copy">
                    <span className="command-option-title"><strong>{file.name}</strong></span>
                    <small>{file.path}</small>
                  </span>
                  <span className="command-option-source">{file.kind}</span>
                </button>
              ))}
              {!searchingFiles && fileMatches.length === 0 ? <p className="file-search-empty">No matching workspace files</p> : null}
              {searchingFiles ? <p className="file-search-empty">Searching…</p> : null}
            </div>
          </div>
        ) : null}

        {paletteOpen ? (
          <div className="command-palette" id={listboxId} role="listbox" aria-label="OMP commands">
            <div className="command-palette-header">
              <span>Commands</span>
              <span><kbd>↑</kbd><kbd>↓</kbd> navigate · <kbd>tab</kbd> complete</span>
            </div>
            <div className="command-palette-list">
              {visibleCommands.map((option, index) => (
                <button
                  key={`${option.source}:${commandValue(option)}`}
                  className={`command-option${index === activeIndex ? " is-active" : ""}`}
                  type="button"
                  role="option"
                  aria-selected={index === activeIndex}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => chooseCommand(option)}
                >
                  <span className={`command-option-icon source-${option.source}`}><SourceIcon source={option.source} /></span>
                  <span className="command-option-copy">
                    <span className="command-option-title">
                      <strong>{commandValue(option).trim()}</strong>
                      {option.active ? <em>current</em> : null}
                    </span>
                    <small>{option.description}</small>
                  </span>
                  <span className="command-option-source">{option.source}</span>
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {attachments.length > 0 ? (
          <div className="composer-attachments" aria-label="Attached files">
            {attachments.map((file) => (
              <span className={`attachment-chip is-${file.kind}`} key={attachmentKey(file)} title={"path" in file ? file.path : file.name}>
                {file.kind === "pasted-image" ? (
                  <img className="attachment-thumb" src={`data:${file.mimeType};base64,${file.data}`} alt="" />
                ) : file.kind === "image" ? (
                  <FileImage size={13} aria-hidden="true" />
                ) : file.kind === "paste" ? (
                  <ClipboardPaste size={13} aria-hidden="true" />
                ) : (
                  <FileText size={13} aria-hidden="true" />
                )}
                <span>{file.name}</span>
                <button type="button" onClick={() => setAttachments((current) => current.filter((item) => attachmentKey(item) !== attachmentKey(file)))} aria-label={`Remove ${file.name}`}>
                  <X size={12} aria-hidden="true" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

        <div className="composer-eyebrow" aria-hidden="true">
          <Sparkles size={13} />
          <span>{isCommandDraft ? "Command mode" : "Ask OMP"}</span>
        </div>
        <label className="visually-hidden" htmlFor={textareaId}>Message or command for OMP</label>
        <textarea
          ref={textareaRef}
          id={textareaId}
          value={draft}
          disabled={disabled || isSending}
          placeholder={placeholder}
          rows={1}
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={paletteOpen}
          aria-controls={paletteOpen ? listboxId : undefined}
          onChange={(event) => {
            setDraft(event.target.value);
            setPaletteDismissed(false);
            if (feedback) setFeedback("");
          }}
          onPaste={handlePaste}
          onKeyDown={handleKeyDown}
        />

        <div className="composer-footer">
          <button
            className={`attach-button${filePickerOpen ? " is-active" : ""}`}
            type="button"
            disabled={disabled || isSending || !onSearchFiles}
            onClick={() => {
              setFilePickerOpen((open) => !open);
              setPaletteDismissed(true);
            }}
            aria-label="Attach workspace file"
            title="Attach workspace file"
          >
            <Paperclip size={13} aria-hidden="true" />
          </button>
          <div id={feedbackId} className="composer-hint" role="status" aria-live="polite">
            {feedback || (disabled ? "Messaging unavailable" : isCommandDraft ? "Enter to run · Esc to close menu" : "Attach files · Type / for commands · Enter to send")}
          </div>
        </div>

        {isStreaming && !isCommandDraft ? (
          <button className="send-button is-abort" type="button" onClick={handleAbort} disabled={disabled || !onAbort || isSending} aria-label="Abort response" title="Abort response">
            <Square size={15} aria-hidden="true" />
          </button>
        ) : (
          <button className="send-button" type="submit" disabled={!canSend} aria-label={isCommandDraft ? "Run command" : "Send message"} title={isCommandDraft ? "Run command" : "Send message"}>
            {isCommandDraft ? <Command size={17} aria-hidden="true" /> : <Send size={17} aria-hidden="true" />}
          </button>
        )}
      </form>
    </div>
  );
}
