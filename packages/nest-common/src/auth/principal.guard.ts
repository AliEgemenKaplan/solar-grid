import {
  applyDecorators,
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  SetMetadata,
  UseGuards,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiForbiddenResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  ApiErrorResponse,
  NotPermittedException,
  UnauthenticatedException,
} from '../errors/api-error';
import { bearerTokenFrom, CredentialVerifier, PrincipalKind } from './credentials';

export const REQUIRED_PRINCIPAL_KEY = 'solar-grid:required-principal';

/** Swagger security scheme names, registered in configureHttpApp. */
export const OPERATOR_AUTH_SCHEME = 'operator';
export const INTERNAL_SERVICE_AUTH_SCHEME = 'internal-service';

export function verifierFromConfig(config: ConfigService): CredentialVerifier {
  return new CredentialVerifier({
    operatorToken: config.get<string>('OPERATOR_API_TOKEN'),
    internalServiceToken: config.get<string>('INTERNAL_API_TOKEN'),
  });
}

/**
 * Lets a request through only when it carries the credentials the route asks
 * for.
 *
 *   no Authorization header, or not a bearer token  → 401
 *   a token nobody recognises                        → 401
 *   a recognised token for a different role         → 403
 *   the right token                                  → allowed
 *
 * If a token is not configured at all, nothing can match it and the route
 * refuses every request: a missing secret fails closed.
 */
@Injectable()
export class PrincipalGuard implements CanActivate {
  private readonly verifier: CredentialVerifier;
  private readonly logger = new Logger(PrincipalGuard.name);

  constructor(
    private readonly reflector: Reflector,
    config: ConfigService,
  ) {
    this.verifier = verifierFromConfig(config);
  }

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<PrincipalKind | undefined>(
      REQUIRED_PRINCIPAL_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) return true;

    const request = context.switchToHttp().getRequest<Request>();
    const token = bearerTokenFrom(request.headers.authorization);

    if (!token) {
      throw new UnauthenticatedException('This endpoint requires an Authorization: Bearer token.');
    }

    const principal = this.verifier.identify(token);
    if (!principal) {
      // The token itself is never logged, not even partially.
      this.logger.warn(`Rejected unrecognised credentials for ${request.method} ${request.url}`);
      throw new UnauthenticatedException('The credentials presented are not recognised.');
    }

    if (principal !== required) {
      this.logger.warn(
        `Rejected ${principal} credentials for ${request.method} ${request.url}, which requires ${required}`,
      );
      throw new NotPermittedException(`This endpoint requires ${required} credentials.`);
    }

    return true;
  }
}

function requires(kind: PrincipalKind, scheme: string) {
  return applyDecorators(
    SetMetadata(REQUIRED_PRINCIPAL_KEY, kind),
    UseGuards(PrincipalGuard),
    ApiBearerAuth(scheme),
    ApiUnauthorizedResponse({
      type: ApiErrorResponse,
      description: 'No bearer token, or one that is not recognised',
    }),
    ApiForbiddenResponse({
      type: ApiErrorResponse,
      description: 'A recognised token that belongs to a different role',
    }),
  );
}

/** For people operating the system. The token never reaches a browser. */
export function RequiresOperator() {
  return requires('operator', OPERATOR_AUTH_SCHEME);
}

/** For calls between Solar Grid services, such as recording a trade in the ledger. */
export function RequiresInternalService() {
  return requires('internal-service', INTERNAL_SERVICE_AUTH_SCHEME);
}
