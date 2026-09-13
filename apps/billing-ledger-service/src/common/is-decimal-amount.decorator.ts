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

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

/**
 * Accepts a decimal string within bounds, and nothing else.
 *
 * Money and energy cross this boundary as text on purpose: a JSON number is a
 * double and cannot hold every amount exactly. Validating the text also lets
 * us refuse values the database would reject anyway - negatives, absurd
 * magnitudes, more precision than the column stores - with a 400 instead of a
 * constraint violation.
 */
export function IsDecimalAmount(
  options: DecimalAmountOptions,
  validationOptions?: ValidationOptions,
) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'isDecimalAmount',
      target: object.constructor,
      propertyName,
      options: validationOptions,
      validator: {
        validate(value: unknown) {
          if (typeof value !== 'string') return false;
          const trimmed = value.trim();
          if (!DECIMAL_STRING.test(trimmed)) return false;

          const decimals = trimmed.includes('.') ? trimmed.split('.')[1].length : 0;
          if (decimals > options.scale) return false;

          return isDecimalWithin(trimmed, options.min, options.max);
        },
        defaultMessage() {
          return `${propertyName} must be a decimal string between ${options.min} and ${options.max} with at most ${options.scale} decimal places`;
        },
      },
    });
  };
}
