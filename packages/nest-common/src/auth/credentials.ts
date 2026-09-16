import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Who a request is acting as.
 *
 * - `operator`: a person running the system - triggering a matching run,
 *   recalculating a price. Never shipped to a browser.
 * - `internal-service`: another Solar Grid service, for the calls that write
 *   money. Never shipped to a browser either, and never the same value as the
 *   operator token, so the two can be told apart.
 */
export type PrincipalKind = 'operator' | 'internal-service';

export interface CredentialConfig {
  operatorToken?: string;
  internalServiceToken?: string;
}

/** Shorter tokens are accepted but flagged, since they are guessable. */
export const RECOMMENDED_TOKEN_LENGTH = 32;

/** The local compose defaults contain this, so they are easy to spot in production. */
export const DEVELOPMENT_TOKEN_MARKER = 'not-for-production';

/**
 * Resolves a bearer token to the principal it belongs to.
 *
 * Tokens are compared in constant time, and both configured tokens are always
 * compared, so the time a request takes says nothing about how close the
 * guess was or which token it nearly matched. Each side is hashed first so the
 * comparison is between equal-length values without revealing the length of
 * the real token.
 */
export class CredentialVerifier {
  private readonly operatorDigest: Buffer | null;
  private readonly internalDigest: Buffer | null;

  constructor(config: CredentialConfig) {
    this.operatorDigest = digestOf(config.operatorToken);
    this.internalDigest = digestOf(config.internalServiceToken);
  }

  /** True when at least one token is configured; otherwise nothing authenticates. */
  get isConfigured(): boolean {
    return this.operatorDigest !== null || this.internalDigest !== null;
  }

  identify(presented: string | undefined): PrincipalKind | null {
    const candidate = digestOf(presented);
    if (!candidate) return null;

    // Evaluate both before deciding, rather than returning on the first match.
    const isOperator = matches(candidate, this.operatorDigest);
    const isInternal = matches(candidate, this.internalDigest);

    if (isOperator) return 'operator';
    if (isInternal) return 'internal-service';
    return null;
  }

  /**
   * Problems worth logging at startup, for the credentials this service
   * actually uses. Never includes the token values.
   */
  static configurationWarnings(
    config: CredentialConfig,
    uses: PrincipalKind[],
    environment?: string,
  ): string[] {
    const warnings: string[] = [];
    const { operatorToken, internalServiceToken } = config;

    const check = (name: string, value: string | undefined, consequence: string) => {
      if (!value) {
        warnings.push(`${name} is not set: ${consequence}.`);
      } else if (value.length < RECOMMENDED_TOKEN_LENGTH) {
        warnings.push(
          `${name} is shorter than ${RECOMMENDED_TOKEN_LENGTH} characters and easy to guess.`,
        );
      } else if (environment === 'production' && value.includes(DEVELOPMENT_TOKEN_MARKER)) {
        warnings.push(`${name} is still the development default. Set a real secret.`);
      }
    };

    if (uses.includes('operator')) {
      check('OPERATOR_API_TOKEN', operatorToken, 'operator endpoints will refuse every request');
    }
    if (uses.includes('internal-service')) {
      check('INTERNAL_API_TOKEN', internalServiceToken, 'service-to-service calls will be refused');
    }

    if (operatorToken && internalServiceToken && operatorToken === internalServiceToken) {
      warnings.push(
        'OPERATOR_API_TOKEN and INTERNAL_API_TOKEN are identical: operator and service calls cannot be told apart.',
      );
    }

    return warnings;
  }
}

/** Extracts the token from `Authorization: Bearer <token>`, or undefined. */
export function bearerTokenFrom(header: string | string[] | undefined): string | undefined {
  const value = Array.isArray(header) ? header[0] : header;
  if (typeof value !== 'string') return undefined;

  const match = /^Bearer\s+(\S+)\s*$/i.exec(value);
  return match ? match[1] : undefined;
}

function digestOf(value: string | undefined): Buffer | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  return createHash('sha256').update(value, 'utf8').digest();
}

function matches(candidate: Buffer, expected: Buffer | null): boolean {
  if (!expected) return false;
  return timingSafeEqual(candidate, expected);
}
