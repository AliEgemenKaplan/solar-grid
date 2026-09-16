import { bearerTokenFrom, CredentialVerifier } from '../src/auth/credentials';

const OPERATOR = 'operator-token-0123456789abcdef0123456789';
const INTERNAL = 'internal-token-0123456789abcdef0123456789';

describe('CredentialVerifier', () => {
  const verifier = new CredentialVerifier({
    operatorToken: OPERATOR,
    internalServiceToken: INTERNAL,
  });

  it('recognises each configured token as its own principal', () => {
    expect(verifier.identify(OPERATOR)).toBe('operator');
    expect(verifier.identify(INTERNAL)).toBe('internal-service');
  });

  it('recognises nothing else', () => {
    expect(verifier.identify('wrong')).toBeNull();
    expect(verifier.identify(OPERATOR.slice(0, -1))).toBeNull();
    expect(verifier.identify(`${OPERATOR}x`)).toBeNull();
    expect(verifier.identify('')).toBeNull();
    expect(verifier.identify(undefined)).toBeNull();
  });

  it('fails closed when no token is configured', () => {
    const unconfigured = new CredentialVerifier({});

    expect(unconfigured.isConfigured).toBe(false);
    expect(unconfigured.identify('')).toBeNull();
    expect(unconfigured.identify('anything')).toBeNull();
  });
});

describe('bearerTokenFrom', () => {
  it('extracts the token from a bearer header', () => {
    expect(bearerTokenFrom('Bearer abc123')).toBe('abc123');
    expect(bearerTokenFrom('bearer abc123')).toBe('abc123');
  });

  it('ignores anything that is not a single bearer token', () => {
    expect(bearerTokenFrom(undefined)).toBeUndefined();
    expect(bearerTokenFrom('')).toBeUndefined();
    expect(bearerTokenFrom('Basic dXNlcjpwYXNz')).toBeUndefined();
    expect(bearerTokenFrom('Bearer')).toBeUndefined();
    expect(bearerTokenFrom('Bearer two tokens')).toBeUndefined();
  });
});

describe('CredentialVerifier.configurationWarnings', () => {
  it('only warns about the credentials a service uses', () => {
    expect(CredentialVerifier.configurationWarnings({}, [])).toEqual([]);
    expect(CredentialVerifier.configurationWarnings({}, ['operator'])).toEqual([
      expect.stringContaining('OPERATOR_API_TOKEN is not set'),
    ]);
  });

  it('flags a short token and a development default in production', () => {
    expect(
      CredentialVerifier.configurationWarnings({ operatorToken: 'short' }, ['operator']),
    ).toEqual([expect.stringContaining('shorter than')]);

    expect(
      CredentialVerifier.configurationWarnings(
        { operatorToken: 'dev-operator-token-not-for-production' },
        ['operator'],
        'production',
      ),
    ).toEqual([expect.stringContaining('development default')]);
  });

  it('flags identical operator and service tokens', () => {
    expect(
      CredentialVerifier.configurationWarnings(
        { operatorToken: OPERATOR, internalServiceToken: OPERATOR },
        ['operator', 'internal-service'],
      ),
    ).toEqual([expect.stringContaining('identical')]);
  });

  it('never repeats a token value in a warning', () => {
    const warnings = CredentialVerifier.configurationWarnings(
      { operatorToken: 'short-secret', internalServiceToken: 'short-secret' },
      ['operator', 'internal-service'],
    );
    expect(warnings.join(' ')).not.toContain('short-secret');
  });
});
