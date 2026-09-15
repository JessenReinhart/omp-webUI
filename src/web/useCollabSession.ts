import { useCallback, useEffect, useRef, useState } from 'react';
import { COLLAB_PROTO } from '@oh-my-pi/pi-wire';
import type {
  AgentEvent,
  AgentSnapshot,
  GuestFrame,
  HostFrame,
  SessionEntry,
  SessionHeader,
  SessionState,
} from '@oh-my-pi/pi-wire';
import type { CollabStatus, UseCollabSessionReturn } from './collabTypes';

const DEFAULT_RELAY_URL = 'wss://my.omp.sh';
const ENVELOPE_HEADER_LENGTH = 4;
const IV_LENGTH = 12;
const ROOM_KEY_BYTES = 32;
const WRITE_TOKEN_BYTES = 16;
const EVENTS_LIMIT = 500;
const MAX_BACKOFF_MS = 30_000;
const HANDSHAKE_TIMEOUT_MS = 30_000;
const GUEST_NAME = 'guest';
const LOCAL_HOSTNAMES: Record<string, true> = {
  localhost: true,
  '127.0.0.1': true,
  '::1': true,
  '[::1]': true,
};

type ParsedCollabLink = {
  wsUrl: string;
  key: Uint8Array;
  writeToken: Uint8Array | null;
};

function base64urlDecode(value: string): Uint8Array {
  const binary = atob(`${value}${'='.repeat((4 - (value.length % 4)) % 4)}`.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function base64urlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function parseCollabLink(link: string | null): ParsedCollabLink | null {
  if (!link) return null;
  try {
    let text = link.trim().replace(/%23/gi, '#');
    const bare = /^([A-Za-z0-9_-]{10,64})[#.]([A-Za-z0-9_-]+)$/.exec(text);
    if (bare) text = `${DEFAULT_RELAY_URL}/r/${bare[1]}.${bare[2]}`;
    else if (!text.includes('://')) text = `wss://${text}`;

    const url = new URL(text);
    if ((url.protocol === 'http:' || url.protocol === 'https:') && url.hash) {
      const parsed = parseCollabLink(url.hash.slice(1));
      if (parsed) return parsed;
    }

    const scheme = url.protocol === 'wss:' || url.protocol === 'https:'
      ? 'wss:'
      : url.protocol === 'ws:' || url.protocol === 'http:'
        ? 'ws:'
        : null;
    if (!scheme || (scheme === 'ws:' && !LOCAL_HOSTNAMES[url.hostname])) return null;

    const room = /^\/r\/([A-Za-z0-9_-]{10,64})(?:\.([A-Za-z0-9_-]+))?$/.exec(url.pathname);
    if (!room) return null;
    const secretText = room[2] ?? url.hash.slice(1);
    if (!secretText || !/^[A-Za-z0-9_-]+$/.test(secretText)) return null;
    const secret = base64urlDecode(secretText);
    if (secret.byteLength !== ROOM_KEY_BYTES && secret.byteLength !== ROOM_KEY_BYTES + WRITE_TOKEN_BYTES) return null;

    return {
      wsUrl: `${scheme}//${url.hostname}${url.port ? `:${url.port}` : ''}/r/${room[1]}`,
      key: secret.subarray(0, ROOM_KEY_BYTES),
      writeToken: secret.byteLength === ROOM_KEY_BYTES + WRITE_TOKEN_BYTES ? secret.subarray(ROOM_KEY_BYTES) : null,
    };
  } catch {
    return null;
  }
}

function asStrict(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

async function importAesKey(bytes: Uint8Array): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', asStrict(bytes), { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

async function sealFrame(key: CryptoKey, iv: Uint8Array, frame: GuestFrame): Promise<ArrayBuffer> {
  return crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: asStrict(iv) },
    key,
    asStrict(new TextEncoder().encode(JSON.stringify(frame))),
  );
}

async function openFrame(key: CryptoKey, iv: Uint8Array, ciphertext: ArrayBuffer): Promise<HostFrame> {
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: asStrict(iv) },
    key,
    asStrict(new Uint8Array(ciphertext)),
  );
  return JSON.parse(new TextDecoder().decode(plaintext)) as HostFrame;
}

function packEnvelope(iv: Uint8Array, ciphertext: ArrayBuffer): Uint8Array {
  const envelope = new Uint8Array(ENVELOPE_HEADER_LENGTH + IV_LENGTH + ciphertext.byteLength);
  // Guest outbound frames always target host peer 0.
  envelope.set(iv, ENVELOPE_HEADER_LENGTH);
  envelope.set(new Uint8Array(ciphertext), ENVELOPE_HEADER_LENGTH + IV_LENGTH);
  return envelope;
}

function unpackEnvelope(data: ArrayBuffer): { iv: Uint8Array; ciphertext: ArrayBuffer } | null {
  if (data.byteLength < ENVELOPE_HEADER_LENGTH + IV_LENGTH) return null;
  return {
    iv: new Uint8Array(data.slice(ENVELOPE_HEADER_LENGTH, ENVELOPE_HEADER_LENGTH + IV_LENGTH)),
    ciphertext: data.slice(ENVELOPE_HEADER_LENGTH + IV_LENGTH),
  };
}

function clearTimer(timer: number | null) {
  if (timer !== null) window.clearTimeout(timer);
}

export function useCollabSession(collabUrl: string | null): UseCollabSessionReturn {
  const [status, setStatus] = useState<CollabStatus>('idle');
  const [ready, setReady] = useState(false);
  const [header, setHeader] = useState<SessionHeader | null>(null);
  const [entries, setEntries] = useState<SessionEntry[]>([]);
  const [events, setEvents] = useState<AgentEvent[]>([]);
  const [state, setState] = useState<SessionState | null>(null);
  const [agents, setAgents] = useState<AgentSnapshot[]>([]);
  const [readOnly, setReadOnly] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const keyRef = useRef<CryptoKey | null>(null);
  const timerRef = useRef<number | null>(null);
  const handshakeTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);
  const generationRef = useRef(0);
  const stoppedRef = useRef(false);
  const snapshotRef = useRef<SessionEntry[] | null>(null);
  const connectRef = useRef<(generation: number) => void>(() => {});

  const sendFrame = useCallback(async (frame: GuestFrame): Promise<void> => {
    const socket = socketRef.current;
    const key = keyRef.current;
    if (!socket || !key) throw new Error('Collaboration connection is unavailable');
    if (socket.readyState !== WebSocket.OPEN) throw new Error('Collaboration connection is not open');

    const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));
    const ciphertext = await sealFrame(key, iv, frame);
    if (socket !== socketRef.current || socket.readyState !== WebSocket.OPEN) {
      throw new Error('Collaboration connection closed before send');
    }
    socket.send(asStrict(packEnvelope(iv, ciphertext)));
  }, []);

  const connect = useCallback((generation: number) => {
    const parsed = parseCollabLink(collabUrl);
    if (!parsed) {
      if (generation === generationRef.current && collabUrl) {
        setError('Invalid collaboration link');
        setStatus('error');
      }
      return;
    }
    const scheduleReconnect = () => {
      if (generation !== generationRef.current || stoppedRef.current || timerRef.current !== null) return;
      const delay = Math.min(100 * 2 ** attemptRef.current++, MAX_BACKOFF_MS) * (0.9 + Math.random() * 0.2);
      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        connectRef.current(generation);
      }, delay);
    };

    setStatus(attemptRef.current ? 'reconnecting' : 'connecting');
    void importAesKey(parsed.key).then(key => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      keyRef.current = key;
      setReadOnly(!parsed.writeToken);
      const socket = new WebSocket(`${parsed.wsUrl}?role=guest`);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      let welcomed = false;
      let handshakeTimedOut = false;
      handshakeTimerRef.current = window.setTimeout(() => {
        handshakeTimerRef.current = null;
        if (generation !== generationRef.current || stoppedRef.current || socket !== socketRef.current || welcomed) return;
        handshakeTimedOut = true;
        setError('Collaboration handshake timed out');
        setStatus('reconnecting');
        socket.close(4000, 'Handshake timeout');
      }, HANDSHAKE_TIMEOUT_MS);

      socket.onopen = () => {
        if (generation !== generationRef.current || stoppedRef.current || socket !== socketRef.current) return;
        const hello: GuestFrame = { t: 'hello', proto: COLLAB_PROTO, name: GUEST_NAME };
        if (parsed.writeToken) hello.writeToken = base64urlEncode(parsed.writeToken);
        void sendFrame(hello).catch(() => {});
      };


      socket.onmessage = async event => {
        if (generation !== generationRef.current || stoppedRef.current || socket !== socketRef.current || typeof event.data === 'string') return;
        const envelope = unpackEnvelope(event.data as ArrayBuffer);
        if (!envelope) return;
        try {
          const frame = await openFrame(key, envelope.iv, envelope.ciphertext);
          if (generation !== generationRef.current || stoppedRef.current || socket !== socketRef.current) return;
          switch (frame.t) {
            case 'welcome':
              welcomed = true;
              clearTimer(handshakeTimerRef.current);
              handshakeTimerRef.current = null;
              attemptRef.current = 0;
              setStatus('live');
              snapshotRef.current = [];
              setHeader(frame.header);
              setState(frame.state);
              setAgents(frame.agents);
              setReadOnly(frame.readOnly ?? !parsed.writeToken);
              setEvents([]);
              setReady(false);
              break;
            case 'snapshot-chunk':
              if (!snapshotRef.current) return;
              snapshotRef.current.push(...frame.entries);
              if (frame.final) {
                setEntries(snapshotRef.current);
                snapshotRef.current = null;
                setReady(true);
              }
              break;
            case 'entry':
              if (snapshotRef.current) snapshotRef.current.push(frame.entry);
              else setEntries(previous => previous.some(entry => entry.id === frame.entry.id) ? previous : [...previous, frame.entry]);
              break;
            case 'event':
              setEvents(previous => {
                const next = [...previous, frame.event];
                return next.length > EVENTS_LIMIT ? next.slice(-EVENTS_LIMIT) : next;
              });
              break;
            case 'state':
              setState(frame.state);
              break;
            case 'agents':
              setAgents(frame.agents);
              break;
            case 'bye':
              stoppedRef.current = true;
              setError('Session ended');
              setStatus('closed');
              socket.close();
              break;
            case 'error':
              stoppedRef.current = true;
              setError('Collaboration host rejected the connection');
              setStatus('error');
              socket.close();
              break;
            default:
              break;
          }
        } catch {
          // Ignore malformed or undecryptable relay traffic.
        }
      };

      socket.onerror = () => {
        if (generation === generationRef.current && !stoppedRef.current && socket === socketRef.current) {
          setError('Connection error');
        }
      };
      socket.onclose = event => {
        if (generation !== generationRef.current || socket !== socketRef.current) return;
        clearTimer(handshakeTimerRef.current);
        handshakeTimerRef.current = null;
        socketRef.current = null;
        keyRef.current = null;
        if (stoppedRef.current || event.code === 1000) return;
        setError(handshakeTimedOut ? 'Collaboration handshake timed out' : 'Connection closed');
        setStatus('reconnecting');
        scheduleReconnect();
      };
    }).catch(() => {
      if (generation !== generationRef.current || stoppedRef.current) return;
      setError('Failed to connect');
      setStatus('error');
      scheduleReconnect();
    });
  }, [collabUrl, sendFrame]);
  connectRef.current = connect;

  const sendPrompt = useCallback(async (text: string): Promise<void> => {
    if (status !== 'live') throw new Error('Collaboration session is not live');
    if (readOnly) throw new Error('Collaboration session is read-only');
    if (!text.trim()) throw new Error('Prompt is empty');
    await sendFrame({ t: 'prompt', text });
  }, [readOnly, sendFrame, status]);

  const sendAbort = useCallback(async (): Promise<void> => {
    if (status !== 'live') throw new Error('Collaboration session is not live');
    if (readOnly) throw new Error('Collaboration session is read-only');
    await sendFrame({ t: 'abort' });
  }, [readOnly, sendFrame, status]);

  const disconnect = useCallback(() => {
    stoppedRef.current = true;
    generationRef.current += 1;
    clearTimer(timerRef.current);
    timerRef.current = null;
    clearTimer(handshakeTimerRef.current);
    handshakeTimerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    keyRef.current = null;
    snapshotRef.current = null;
    setStatus('closed');
    setReady(false);
  }, []);

  const reconnect = useCallback(() => {
    stoppedRef.current = false;
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimer(timerRef.current);
    timerRef.current = null;
    clearTimer(handshakeTimerRef.current);
    handshakeTimerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    keyRef.current = null;
    snapshotRef.current = null;
    attemptRef.current = 0;
    setError(null);
    setReady(false);
    connect(generation);
  }, [connect]);

  useEffect(() => {
    stoppedRef.current = false;
    generationRef.current += 1;
    const generation = generationRef.current;
    clearTimer(timerRef.current);
    timerRef.current = null;
    clearTimer(handshakeTimerRef.current);
    handshakeTimerRef.current = null;
    socketRef.current?.close();
    socketRef.current = null;
    keyRef.current = null;
    snapshotRef.current = null;
    attemptRef.current = 0;
    setStatus('idle');
    setReady(false);
    setHeader(null);
    setEntries([]);
    setEvents([]);
    setState(null);
    setAgents([]);
    setReadOnly(false);
    setError(null);
    if (collabUrl) connect(generation);
    return () => {
      if (generation !== generationRef.current) return;
      stoppedRef.current = true;
      clearTimer(timerRef.current);
      timerRef.current = null;
      clearTimer(handshakeTimerRef.current);
      handshakeTimerRef.current = null;
      socketRef.current?.close();
      socketRef.current = null;
    };
  }, [collabUrl, connect]);

  return { status, ready, header, entries, events, state, agents, readOnly, error, sendPrompt, sendAbort, reconnect, disconnect };
}
