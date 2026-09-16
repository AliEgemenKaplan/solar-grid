import { applyDecorators } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';
import { registerDecorator, ValidationOptions } from 'class-validator';
import { isDecimalWithin } from '@solar-grid/shared-utils';

export interface DecimalAmountOptions {
  /** Inclusive lower bound, as a decimal string. */
  min: string;
  /** Inclusive upper bound, as a decimal string. */
  max: string;
  /** Maximum digits after the point. */
  scale: number;
}

/**
 * Plain digits with an optional fraction. Deliberately excludes exponents,
 * a leading "+", "NaN", "Infinity", whitespace inside the number, thousands
 * separators and an empty fraction ("4."): each of those parses somewhere and
 * means something different somewhere else.
 */
const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/** Why a decimal string was refused, or null when it is acceptable. */
export function decimalAmountProblem(value: unknown, options: DecimalAmountOptions): string | null {
  if (typeof value !== 'string') return 'must be a decimal string, not a JSON number';
  if (value.length === 0) return 'must not be empty';
  if (value !== value.trim()) return 'must not contain surrounding whitespace';
  if (!DECIMAL_STRING.test(value)) return 'must be a plain decimal such as "4.000"';

  const fraction = value.includes('.') ? value.split('.')[1] : '';
  if (fraction.length > options.scale) {
    return `must have at most ${options.scale} decimal places`;
  }

  if (!isDecimalWithin(value, options.min, options.max)) {
    return `must be between ${options.min} and ${options.max}`;
  }
  return null;
}

/**
 * Accepts a decimal string within bounds, and nothing else.
 *
 * Money and energy cross this boundary as text on purpose: a JSON number is a
 * double and cannot hold every amount exactly. Refusing negatives, absurd
 * magnitudes and more precision than the column stores here means the caller
 * gets a 400 naming the field, instead of a constraint violation deep inside
 * a transaction.
 */
export function IsDecimalAmount(
  options: DecimalAmountOptions,
  validationOptions?: ValidationOptions,
): PropertyDecorator {
  return function (object: object, propertyKey: string | symbol) {
    const propertyName = String(propertyKey);
    registerDecorator({
      name: 'isDecimalAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate: (value: unknown) => decimalAmountProblem(value, options) === null,
        defaultMessage: (args) =>
          `${propertyName} ${decimalAmountProblem(args?.value, options) ?? 'is not a valid decimal amount'}`,
      },
    });
  };
}

/**
 * Validation and OpenAPI documentation in one decorator, so the schema a
 * client reads can never disagree with what the server enforces. The field is
 * documented as a string, because that is what it is on the wire.
 */
export function DecimalAmountField(
  options: DecimalAmountOptions & { example: string; description: string },
) {
  return applyDecorators(
    ApiProperty({
      type: String,
      format: 'decimal',
      pattern: `^\\d+(\\.\\d{1,${options.scale}})?$`,
      example: options.example,
      description: `${options.description}. Decimal string, ${options.min} to ${options.max}, at most ${options.scale} decimal places.`,
    }),
    IsDecimalAmount(options),
  );
}
