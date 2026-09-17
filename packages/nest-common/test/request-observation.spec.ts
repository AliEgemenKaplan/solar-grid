import { EventEmitter } from 'node:events';
import type { Request, Response } from 'express';
import { observeRequests, RequestObservation } from '../src/http/request-observation';

function fakeExchange(options: { url: string; routePath?: string; correlationId?: string }) {
  const req = {
    method: 'GET',
    originalUrl: options.url,
    url: options.url,
    baseUrl: '',
    headers: options.correlationId ? { 'x-correlation-id': options.correlationId } : {},
    route: options.routePath ? { path: options.routePath } : undefined,
  } as unknown as Request;
  const res = Object.assign(new EventEmitter(), {
    statusCode: 200,
    writableFinished: false,
  }) as unknown as Response & EventEmitter & { writableFinished: boolean };
  return { req, res };
}

function logger() {
  return { log: jest.fn(), debug: jest.fn(), warn: jest.fn() };
}

describe('observeRequests', () => {
  it('reports the route template, the path without its query, the status and the correlation id', () => {
    const observed: RequestObservation[] = [];
    const log = logger();
    const middleware = observeRequests([(o) => observed.push(o)], log);
    const { req, res } = fakeExchange({
      url: '/trades/TRD-1?secretish=value',
      routePath: '/trades/:tradeId',
      correlationId: 'cid-7',
    });
    const next = jest.fn();

    middleware(req, res, next);
    res.statusCode = 404;
    res.writableFinished = true;
    res.emit('finish');

    expect(next).toHaveBeenCalled();
    expect(observed).toEqual([
      expect.objectContaining({
        method: 'GET',
        route: '/trades/:tradeId',
        path: '/trades/TRD-1',
        statusCode: 404,
        correlationId: 'cid-7',
        aborted: false,
      }),
    ]);
    expect(log.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'http.request.completed', statusCode: 404 }),
    );
    expect(JSON.stringify(log.log.mock.calls)).not.toContain('secretish');
  });

  it('reports each request once, even though both finish and close fire', () => {
    const observer = jest.fn();
    const { req, res } = fakeExchange({ url: '/matches', routePath: '/matches' });

    observeRequests([observer], logger())(req, res, jest.fn());
    res.writableFinished = true;
    res.emit('finish');
    res.emit('close');

    expect(observer).toHaveBeenCalledTimes(1);
  });

  it('logs probes quietly', () => {
    const log = logger();
    const { req, res } = fakeExchange({ url: '/health/ready', routePath: '/health/ready' });

    observeRequests([], log)(req, res, jest.fn());
    res.writableFinished = true;
    res.emit('finish');

    expect(log.debug).toHaveBeenCalled();
    expect(log.log).not.toHaveBeenCalled();
  });

  it('marks a request the client abandoned', () => {
    const log = logger();
    const { req, res } = fakeExchange({ url: '/matches', routePath: '/matches' });

    observeRequests([], log)(req, res, jest.fn());
    res.emit('close');

    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'http.request.aborted', aborted: true }),
    );
  });

  it('names unmatched routes without echoing arbitrary paths as a route', () => {
    const observer = jest.fn();
    const { req, res } = fakeExchange({ url: '/does-not-exist' });

    observeRequests([observer], logger())(req, res, jest.fn());
    res.statusCode = 404;
    res.writableFinished = true;
    res.emit('finish');

    expect(observer.mock.calls[0][0].route).toBe('unmatched');
  });

  it('keeps going when an observer throws', () => {
    const second = jest.fn();
    const { req, res } = fakeExchange({ url: '/matches', routePath: '/matches' });

    observeRequests(
      [
        () => {
          throw new Error('metrics broke');
        },
        second,
      ],
      logger(),
    )(req, res, jest.fn());
    res.writableFinished = true;

    expect(() => res.emit('finish')).not.toThrow();
    expect(second).toHaveBeenCalled();
  });
});
