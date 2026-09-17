import type { LoggerService, LogLevel } from '@nestjs/common';

export type LogFormat = 'json' | 'pretty';

/**
 * What an operationally important log line carries. `event` is a stable,
 * dotted name - `outbox.event.published`, `trade.settled` - so a line can be
 * found by what happened rather than by how the message happens to be worded.
 */
export interface LogEvent {
  event: string;
  message?: string;
  correlationId?: string;
  [field: string]: unknown;
}

export interface StructuredLoggerOptions {
  service: string;
  format?: LogFormat;
  /** The least severe level written. */
  level?: LogLevel;
  /**
   * Exact values that must never appear in a log line, whatever carries them:
   * tokens, passwords. Replaced wherever they occur.
   */
  secrets?: string[];
  /** Replaced in tests; by default lines go to stdout, errors to stderr. */
  write?: (line: string, level: LogLevel) => void;
  now?: () => Date;
}

const SEVERITY: Record<LogLevel, number> = {
  verbose: 0,
  debug: 1,
  log: 2,
  warn: 3,
  error: 4,
  fatal: 5,
};

/** Nest's level names, as the rest of the world spells them. */
const LEVEL_NAME: Record<LogLevel, string> = {
  verbose: 'trace',
  debug: 'debug',
  log: 'info',
  warn: 'warn',
  error: 'error',
  fatal: 'fatal',
};

const REDACTED = '[REDACTED]';

/** Field names whose value is never written, whatever it is. */
const SENSITIVE_KEY = /authorization|password|passwd|secret|token|cookie|api[-_]?key|credential/i;

/** Nest passes a stack trace as a plain string argument; this recognises one. */
const STACK_TRACE = /\n\s+at\s/;

/**
 * The application logger: one JSON object per line in production, a readable
 * line in development.
 *
 * Every line carries a timestamp, level, service and, when the caller knows
 * them, the event name and correlation id. Nest's own logs - routes mapped,
 * modules initialised - come through here too, so there is one format for
 * the whole process.
 *
 * Writing a log line must never be the thing that breaks a request or a
 * consumer, so nothing in here throws: a value that cannot be serialised is
 * described instead, and if even that fails a fixed line is written.
 */
export class StructuredLogger implements LoggerService {
  private readonly service: string;
  private readonly format: LogFormat;
  private minimum: number;
  private enabled: Set<LogLevel> | null = null;
  private readonly secrets: string[];
  private readonly writeLine: (line: string, level: LogLevel) => void;
  private readonly now: () => Date;

  constructor(options: StructuredLoggerOptions) {
    this.service = options.service;
    this.format = options.format ?? 'json';
    this.minimum = SEVERITY[options.level ?? 'log'];
    // Longest first, so a secret containing another is replaced whole.
    this.secrets = (options.secrets ?? [])
      .filter((secret) => secret.length >= 8)
      .sort((a, b) => b.length - a.length);
    this.writeLine = options.write ?? defaultWrite;
    this.now = options.now ?? (() => new Date());
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('log', message, optionalParams);
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('error', message, optionalParams);
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('warn', message, optionalParams);
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('debug', message, optionalParams);
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('verbose', message, optionalParams);
  }

  fatal(message: unknown, ...optionalParams: unknown[]): void {
    this.emit('fatal', message, optionalParams);
  }

  /** Called by Nest when the application is given explicit log levels. */
  setLogLevels(levels: LogLevel[]): void {
    this.enabled = new Set(levels);
  }

  isLevelEnabled(level: LogLevel): boolean {
    if (this.enabled) return this.enabled.has(level);
    return SEVERITY[level] >= this.minimum;
  }

  private emit(level: LogLevel, message: unknown, params: unknown[]): void {
    if (!this.isLevelEnabled(level)) return;
    try {
      const entry = this.buildEntry(level, message, params);
      const line = this.format === 'json' ? this.toJson(entry) : this.toPretty(entry);
      this.writeLine(this.scrub(line), level);
    } catch {
      try {
        this.writeLine(
          JSON.stringify({
            timestamp: new Date().toISOString(),
            level: 'error',
            service: this.service,
            event: 'log.write_failed',
            message: 'A log line could not be written',
          }),
          'error',
        );
      } catch {
        // Nowhere left to report it; the caller must carry on regardless.
      }
    }
  }

  private buildEntry(
    level: LogLevel,
    message: unknown,
    params: unknown[],
  ): Record<string, unknown> {
    const { context, stack } = splitParams(level, params);
    const entry: Record<string, unknown> = {
      timestamp: this.now().toISOString(),
      level: LEVEL_NAME[level],
      service: this.service,
    };
    if (context) entry.context = context;

    if (message instanceof Error) {
      entry.message = message.message;
      entry.error = describeError(message);
    } else if (isPlainObject(message)) {
      const { event, message: text, error, ...fields } = message as Record<string, unknown>;
      if (typeof event === 'string') entry.event = event;
      if (text !== undefined) entry.message = typeof text === 'string' ? text : safeString(text);
      for (const [key, value] of Object.entries(fields)) {
        if (value !== undefined) entry[key] = value;
      }
      if (error !== undefined) {
        entry.error = error instanceof Error ? describeError(error) : error;
      }
    } else {
      entry.message = typeof message === 'string' ? message : safeString(message);
    }

    if (stack) {
      const described = (entry.error as Record<string, unknown> | undefined) ?? {};
      entry.error = { ...described, stack };
    }
    return entry;
  }

  private toJson(entry: Record<string, unknown>): string {
    return JSON.stringify(entry, redactingReplacer());
  }

  private toPretty(entry: Record<string, unknown>): string {
    const { timestamp, level, service, context, event, message, error, ...fields } = entry;
    const scope = context ? `${service}/${context}` : service;
    const head = [
      timestamp,
      String(level).toUpperCase().padEnd(5),
      `[${scope}]`,
      event ? String(event) : undefined,
      message ? String(message) : undefined,
    ]
      .filter(Boolean)
      .join(' ');

    const redacted = JSON.parse(JSON.stringify(fields, redactingReplacer())) as Record<
      string,
      unknown
    >;
    const pairs = Object.entries(redacted)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : JSON.stringify(value)}`)
      .join(' ');

    let line = pairs ? `${head} ${pairs}` : head;
    if (error && typeof error === 'object') {
      const { stack, ...rest } = JSON.parse(JSON.stringify(error, redactingReplacer())) as Record<
        string,
        unknown
      >;
      if (Object.keys(rest).length > 0) line += ` error=${JSON.stringify(rest)}`;
      if (typeof stack === 'string') line += `\n${stack}`;
    }
    return line;
  }

  /** Removes secrets and credentials from the finished line. */
  private scrub(line: string): string {
    let result = scrubCredentials(line);
    for (const secret of this.secrets) {
      if (result.includes(secret)) result = result.split(secret).join(REDACTED);
    }
    return result;
  }
}

/**
 * The logger a service runs with, configured from its environment:
 * LOG_FORMAT (json by default in production, pretty elsewhere), LOG_LEVEL
 * (log), and every token and password it was given as a value to redact.
 */
export function createServiceLogger(
  service: string,
  env: NodeJS.ProcessEnv = process.env,
): StructuredLogger {
  const format: LogFormat =
    env.LOG_FORMAT === 'json' || env.LOG_FORMAT === 'pretty'
      ? env.LOG_FORMAT
      : env.NODE_ENV === 'production'
        ? 'json'
        : 'pretty';
  const level = isLogLevel(env.LOG_LEVEL) ? env.LOG_LEVEL : 'log';
  return new StructuredLogger({ service, format, level, secrets: secretsFrom(env) });
}

/** Values in the environment that must never be logged. */
export function secretsFrom(env: NodeJS.ProcessEnv): string[] {
  const secrets: string[] = [];
  for (const [key, value] of Object.entries(env)) {
    if (!value) continue;
    if (/(TOKEN|PASSWORD|SECRET)$/.test(key)) secrets.push(value);
    if (/_URL$/.test(key)) {
      const password = passwordIn(value);
      if (password) secrets.push(password);
    }
  }
  return secrets;
}

/**
 * Credentials that can turn up inside a message - an authorization header, a
 * connection string - are replaced even when nobody configured them as secrets.
 */
export function scrubCredentials(text: string): string {
  return text
    .replace(/(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REDACTED}`)
    .replace(/([a-z][a-z0-9+.-]*:\/\/[^:/?#\s@"]+):[^@\s/"]+@/gi, `$1:${REDACTED}@`);
}

function redactingReplacer() {
  const seen = new WeakSet<object>();
  return function (this: unknown, key: string, value: unknown): unknown {
    if (key && SENSITIVE_KEY.test(key) && value !== undefined && value !== null) return REDACTED;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Error) return describeError(value);
    if (typeof value === 'object' && value !== null) {
      if (seen.has(value)) return '[Circular]';
      seen.add(value);
    }
    return value;
  };
}

function splitParams(level: LogLevel, params: unknown[]): { context?: string; stack?: string } {
  const strings = [...params];
  let context: string | undefined;
  let stack: string | undefined;

  // Nest always passes the context last, and a stack before it.
  const last = strings[strings.length - 1];
  if (typeof last === 'string' && !STACK_TRACE.test(last)) {
    context = last;
    strings.pop();
  }
  if (level === 'error' || level === 'fatal') {
    const candidate = strings.find((value) => typeof value === 'string' && STACK_TRACE.test(value));
    if (typeof candidate === 'string') stack = candidate;
  }
  return { context, stack };
}

function describeError(error: Error): Record<string, unknown> {
  const described: Record<string, unknown> = { name: error.name, message: error.message };
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string' || typeof code === 'number') described.code = code;
  if (error.stack) described.stack = error.stack;
  return described;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function safeString(value: unknown): string {
  try {
    return typeof value === 'object' ? JSON.stringify(value, redactingReplacer()) : String(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function passwordIn(value: string): string | null {
  try {
    const url = new URL(value);
    return url.password ? decodeURIComponent(url.password) : null;
  } catch {
    return null;
  }
}

function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === 'string' && value in SEVERITY;
}

function defaultWrite(line: string, level: LogLevel): void {
  const stream = SEVERITY[level] >= SEVERITY.error ? process.stderr : process.stdout;
  stream.write(`${line}\n`);
}
