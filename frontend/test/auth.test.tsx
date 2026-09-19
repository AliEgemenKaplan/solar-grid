import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { apiError, fakeApi, ok } from './fixtures';
import { OPERATOR_TOKEN, renderApp } from './render';

const tokenField = () => screen.getByLabelText('Operator token');

async function signIn(token: string) {
  const user = userEvent.setup();
  await user.type(tokenField(), token);
  await user.click(screen.getByRole('button', { name: 'Sign in' }));
}

describe('operator sign-in', () => {
  it('shows the sign-in form, with service readiness, before anything else', async () => {
    renderApp();

    expect(screen.getByRole('heading', { name: 'Operator sign-in' })).toBeInTheDocument();
    expect(tokenField()).toHaveAttribute('type', 'password');
    expect(await screen.findAllByText('Ready')).toHaveLength(4);
  });

  it('checks the token with the backend and opens the dashboard', async () => {
    const { api, tokens } = renderApp();
    await signIn(OPERATOR_TOKEN);

    expect(
      await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' }),
    ).toBeInTheDocument();
    expect(api.verifyOperatorToken).toHaveBeenCalledWith(
      'tradeMatching',
      OPERATOR_TOKEN,
      expect.any(Date),
    );
    expect(tokens.get()).toBe(OPERATOR_TOKEN);
    expect(sessionStorage.getItem('solar-grid.operator-token')).toBe(OPERATOR_TOKEN);
  });

  it('never shows the token once it has been accepted', async () => {
    const { container } = renderApp();
    await signIn(OPERATOR_TOKEN);
    await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });

    expect(container.innerHTML).not.toContain(OPERATOR_TOKEN);
    expect(document.body.innerHTML).not.toContain(OPERATOR_TOKEN);
  });

  it('refuses a token the backend does not recognise, and keeps nothing', async () => {
    const api = fakeApi({
      verifyOperatorToken: vi.fn(async () => Promise.reject(apiError('unauthorized'))),
    });
    const { tokens } = renderApp({ api });
    await signIn('not-the-right-token');

    expect(await screen.findByRole('alert')).toHaveTextContent('That token was not accepted.');
    expect(tokens.get()).toBeNull();
    expect(sessionStorage.length).toBe(0);
    expect(tokenField()).toHaveValue('');
  });

  it('submits with Enter, and asks for a token when there is none', async () => {
    const user = userEvent.setup();
    const { api } = renderApp();

    await user.click(tokenField());
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter the operator token.');
    expect(api.verifyOperatorToken).not.toHaveBeenCalled();

    await user.type(tokenField(), `${OPERATOR_TOKEN}{Enter}`);
    expect(
      await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' }),
    ).toBeInTheDocument();
  });

  it('refuses a token that belongs to another role', async () => {
    const api = fakeApi({
      verifyOperatorToken: vi.fn(async () => Promise.reject(apiError('forbidden'))),
    });
    renderApp({ api });
    await signIn('the-internal-service-token');

    expect(await screen.findByRole('alert')).toHaveTextContent('belongs to another role');
  });

  it('asks the next service when the first cannot be reached', async () => {
    const verify = vi.fn().mockRejectedValueOnce(apiError('network')).mockResolvedValueOnce(ok({}));
    renderApp({ api: fakeApi({ verifyOperatorToken: verify }) });
    await signIn(OPERATOR_TOKEN);

    await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });
    expect(verify.mock.calls.map((call) => call[0])).toEqual(['tradeMatching', 'billing']);
  });

  it('says so when no service can check the token', async () => {
    const api = fakeApi({
      verifyOperatorToken: vi.fn(async () => Promise.reject(apiError('network'))),
    });
    renderApp({ api });
    await signIn(OPERATOR_TOKEN);

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'No Solar Grid service could be reached',
    );
  });
});

describe('the operator session', () => {
  it('signs out and forgets the token', async () => {
    const user = userEvent.setup();
    const { tokens } = renderApp({ signedIn: true });
    await screen.findByRole('heading', { name: 'Solar Grid operator dashboard' });

    await user.click(screen.getByRole('button', { name: 'Sign out' }));

    expect(await screen.findByRole('heading', { name: 'Operator sign-in' })).toBeInTheDocument();
    expect(screen.getByText(/You have signed out/)).toBeInTheDocument();
    expect(tokens.get()).toBeNull();
    expect(sessionStorage.length).toBe(0);
  });

  it('ends the session when the backend stops accepting the token', async () => {
    const api = fakeApi({
      tradeSummary: vi.fn(async () => Promise.reject(apiError('unauthorized'))),
    });
    const { tokens } = renderApp({ api, signedIn: true });

    expect(
      await screen.findByText('The operator token is no longer accepted. Sign in again.'),
    ).toBeInTheDocument();
    expect(tokens.get()).toBeNull();
  });

  it('ends the session on a 403 as well, and says why', async () => {
    const api = fakeApi({
      energySummary: vi.fn(async () => Promise.reject(apiError('forbidden'))),
    });
    renderApp({ api, signedIn: true });

    expect(await screen.findByText(/not allowed to read operator statistics/)).toBeInTheDocument();
  });

  it('keeps the session across a reload of the tab', async () => {
    sessionStorage.setItem('solar-grid.operator-token', OPERATOR_TOKEN);
    renderApp();

    await waitFor(() =>
      expect(
        screen.getByRole('heading', { name: 'Solar Grid operator dashboard' }),
      ).toBeInTheDocument(),
    );
  });
});
