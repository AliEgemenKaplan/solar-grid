import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { HEADER_CORRELATION_ID } from '@solar-grid/shared-contracts';
import { ApiErrorCode, ApiErrorResponse, readCodedBody } from './api-error';

/**
 * Turns anything thrown into the one error body this system returns.
 *
 * Two rules drive it. A client gets a status, a machine readable code, and a
 * correlation id it can quote; it never gets a stack trace, a SQL fragment, a
 * constraint name or anything else that describes the inside of the service.
 * Those go to the log, against the same correlation id.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpException');

  catch(exception: unknown, host: ArgumentsHost): void {
    // Global filters also catch what a RabbitMQ handler throws. That error has
    // no HTTP response to become; it belongs to the consumer's retry and dead
    // letter handling, so it goes back unchanged.
    if (host.getType() !== 'http') throw exception;

    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    const correlationId = readCorrelationId(request);
    const body = this.toErrorBody(exception, request, correlationId);

    if (body.statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
      // The client is told nothing useful about this, so the log has to carry
      // everything: the real error and where it came from.
      this.logger.error(
        `${request.method} ${request.url} failed: ${describe(exception)} [cid=${correlationId}]`,
        exception instanceof Error ? exception.stack : undefined,
      );
    } else {
      this.logger.warn(
        `${request.method} ${request.url} -> ${body.statusCode} ${body.code}: ${body.message} [cid=${correlationId}]`,
      );
    }

    response.status(body.statusCode).json(body);
  }

  private toErrorBody(
    exception: unknown,
    request: Request,
    correlationId: string,
  ): ApiErrorResponse {
    const base = {
      correlationId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (exception instanceof HttpException) {
      const statusCode = exception.getStatus();
      const coded = readCodedBody(exception);
      if (coded) {
        return {
          ...base,
          statusCode,
          code: coded.code,
          message: coded.message,
          details: coded.details,
        };
      }

      // A framework exception: the validation pipe, a bare NotFoundException,
      // the throttler. Derive a code from the status and keep the message.
      const { message, details } = splitNestMessage(exception);
      return { ...base, statusCode, code: codeForStatus(statusCode), message, details };
    }

    if (isPrismaKnownError(exception)) {
      // Prisma error codes are an implementation detail; the client sees the
      // shape of the problem, not the constraint that produced it.
      const mapped = mapPrismaError(exception.code);
      if (mapped) return { ...base, ...mapped };
    }

    return {
      ...base,
      statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ApiErrorCode.INTERNAL_ERROR,
      message: 'The request could not be completed.',
    };
  }
}

function readCorrelationId(request: Request): string {
  const value = request.headers?.[HEADER_CORRELATION_ID];
  if (Array.isArray(value)) return value[0] ?? 'unknown';
  return typeof value === 'string' && value.length > 0 ? value : 'unknown';
}

/**
 * The validation pipe throws a BadRequestException whose message is an array
 * of field problems. Those are safe to return - they describe the request the
 * caller sent - but they belong in `details`, not in `message`.
 */
function splitNestMessage(exception: HttpException): { message: string; details?: string[] } {
  const response = exception.getResponse();

  if (typeof response === 'string') return { message: response };

  const candidate = response as { message?: string | string[]; error?: string };
  if (Array.isArray(candidate.message)) {
    return { message: 'Request validation failed.', details: candidate.message };
  }
  if (typeof candidate.message === 'string') return { message: candidate.message };
  return { message: exception.message };
}

function codeForStatus(status: number): ApiErrorCode {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.VALIDATION_FAILED;
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHENTICATED;
    case HttpStatus.FORBIDDEN:
      return ApiErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.CONFLICT;
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return ApiErrorCode.BUSINESS_RULE_VIOLATION;
    case HttpStatus.TOO_MANY_REQUESTS:
      return ApiErrorCode.RATE_LIMITED;
    case HttpStatus.SERVICE_UNAVAILABLE:
      return ApiErrorCode.DOWNSTREAM_UNAVAILABLE;
    default:
      return status >= HttpStatus.INTERNAL_SERVER_ERROR
        ? ApiErrorCode.INTERNAL_ERROR
        : ApiErrorCode.VALIDATION_FAILED;
  }
}

/**
 * Recognised by shape rather than by type: every service generates its own
 * Prisma client, so there is no single class this package could import.
 */
function isPrismaKnownError(error: unknown): error is { code: string; name: string } {
  return (
    typeof error === 'object' &&
    error !== null &&
    typeof (error as { code?: unknown }).code === 'string' &&
    (error as { name?: unknown }).name === 'PrismaClientKnownRequestError'
  );
}

function mapPrismaError(
  prismaCode: string,
): Pick<ApiErrorResponse, 'statusCode' | 'code' | 'message'> | null {
  switch (prismaCode) {
    case 'P2002':
      return {
        statusCode: HttpStatus.CONFLICT,
        code: ApiErrorCode.CONFLICT,
        message: 'That resource already exists.',
      };
    case 'P2025':
      return {
        statusCode: HttpStatus.NOT_FOUND,
        code: ApiErrorCode.NOT_FOUND,
        message: 'The requested resource does not exist.',
      };
    case 'P2003':
      return {
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ApiErrorCode.BUSINESS_RULE_VIOLATION,
        message: 'The request refers to something that does not exist.',
      };
    case 'P2000':
    case 'P2006':
      return {
        statusCode: HttpStatus.BAD_REQUEST,
        code: ApiErrorCode.VALIDATION_FAILED,
        message: 'A value in the request is not valid for its field.',
      };
    default:
      // Anything else is a bug or an outage, not something the caller can fix.
      return null;
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : String(error);
}
