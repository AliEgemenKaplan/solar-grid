import { installGracefulShutdown } from '../src/lifecycle/graceful-shutdown';

function silentLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

describe('installGracefulShutdown', () => {
  const installed: Array<{ dispose(): void }> = [];

  afterEach(() => {
    while (installed.length > 0) installed.pop()?.dispose();
    jest.useRealTimers();
  });

  function install(close: () => Promise<void>, timeoutMs = 1000) {
    const exit = jest.fn();
    const logger = silentLogger();
    const handle = installGracefulShutdown({ close }, { timeoutMs, exit, logger, signals: [] });
    installed.push(handle);
    return { handle, exit, logger };
  }

  it('closes the application and exits cleanly', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const { handle, exit } = install(close);

    await handle.shutdown('SIGTERM');

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('waits for close to finish before exiting', async () => {
    let finishClose!: () => void;
    const close = jest.fn(() => new Promise<void>((resolve) => (finishClose = resolve)));
    const { handle, exit } = install(close);

    const shuttingDown = handle.shutdown('SIGTERM');
    await Promise.resolve();
    expect(exit).not.toHaveBeenCalled();

    finishClose();
    await shuttingDown;
    expect(exit).toHaveBeenCalledWith(0);
  });

  it('exits with a failure when close throws', async () => {
    const { handle, exit, logger } = install(jest.fn().mockRejectedValue(new Error('stuck')));

    await handle.shutdown('SIGTERM');

    expect(exit).toHaveBeenCalledWith(1);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('stuck'));
  });

  it('gives up after the deadline instead of hanging forever', async () => {
    jest.useFakeTimers();
    const { handle, exit } = install(() => new Promise<void>(() => undefined), 5000);

    void handle.shutdown('SIGTERM');
    jest.advanceTimersByTime(4999);
    expect(exit).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(exit).toHaveBeenCalledWith(1);
  });

  it('exits at once on a second signal', async () => {
    const { handle, exit } = install(() => new Promise<void>(() => undefined));

    void handle.shutdown('SIGINT');
    await handle.shutdown('SIGINT');

    expect(exit).toHaveBeenCalledWith(1);
  });

  it('runs on the signals it is installed for', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const exit = jest.fn();
    const handle = installGracefulShutdown(
      { close },
      { exit, logger: silentLogger(), signals: ['SIGUSR2'] },
    );
    installed.push(handle);

    process.emit('SIGUSR2', 'SIGUSR2');
    await new Promise((resolve) => setImmediate(resolve));

    expect(close).toHaveBeenCalledTimes(1);
    expect(exit).toHaveBeenCalledWith(0);
  });
});
