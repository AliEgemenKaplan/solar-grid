import { Logger } from '@nestjs/common';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';

/** One finished HTTP request, as observability sees it. */
export interface RequestObservation {
  method: string;
  /** The route template, `/trades/:tradeId`, or `unmatched` when none applied. */
  route: string;
  /** The path actually requested, without its query string. */
  path: string;
  statusCode: number;
  durationMs: number;
  correlationId?: string;
  /** The client went away before the response was sent. */
  aborted: boolean;
}

export type RequestObserver = (observation: RequestObservation) => void;

/**
 * Probes and scrapers call these constantly; their lines are logged at debug
 * level so they do not drown out real traffic.
 */
const QUIET_PATHS = new Set(['/health', '/health/live', '/health/ready', '/metrics']);

/**
 * Express middleware that reports every request once it has finished: method,
 * route, status, duration and correlation id. Never the query string, the
 * body or any header other than the correlation id.
 *
 * It is middleware, not a Nest interceptor, on purpose: global interceptors
 * also run in front of RabbitMQ handlers, and HTTP-only code there is the bug
 * that once stopped every energy event from being processed.
 */
export function observeRequests(
  observers: RequestObserver[] = [],
  logger: Pick<Logger, 'log' | 'debug' | 'warn'> = new Logger('HttpRequest'),
): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const started = process.hrtime.bigint();
    let reported = false;

    const report = () => {
      if (reported) return;
      reported = true;
      try {
        const observation: RequestObservation = {
          method: req.method,
          route: routeOf(req),
          path: pathOf(req),
          statusCode: res.statusCode,
          durationMs: Number((process.hrtime.bigint() - started) / BigInt(1000)) / 1000,
          correlationId: headerValue(req.headers[HEADER_CORRELATION_ID]),
          aborted: !res.writableFinished,
        };
        logObservation(logger, observation);
        for (const observer of observers) {
          try {
            observer(observation);
          } catch {
            // An observer failing must not affect the request or the others.
          }
        }
      } catch {
        // Nothing about reporting a request may break serving it.
      }
    };

    res.once('finish', report);
    res.once('close', report);
    next();
  };
}

function logObservation(
  logger: Pick<Logger, 'log' | 'debug' | 'warn'>,
  observation: RequestObservation,
): void {
  const entry = {
    event: observation.aborted ? 'http.request.aborted' : 'http.request.completed',
    message: `${observation.method} ${observation.route} ${observation.statusCode} in ${observation.durationMs}ms`,
    ...observation,
  };
  if (observation.aborted) logger.warn(entry);
  else if (QUIET_PATHS.has(observation.path)) logger.debug(entry);
  else logger.log(entry);
}

function routeOf(req: Request): string {
  const route = (req as Request & { route?: { path?: unknown } }).route;
  if (route && typeof route.path === 'string') return `${req.baseUrl ?? ''}${route.path}`;
  return 'unmatched';
}

function pathOf(req: Request): string {
  const url = req.originalUrl ?? req.url ?? '';
  const query = url.indexOf('?');
  return query === -1 ? url : url.slice(0, query);
}

function headerValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
