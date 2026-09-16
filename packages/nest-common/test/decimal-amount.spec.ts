import { decimalAmountProblem } from '../src/validation/decimal-amount';

const energy = { min: '0.001', max: '1000000', scale: 3 };

describe('decimalAmountProblem', () => {
  it.each(['4.000', '4', '0.001', '1000000', '999999.999', '7.5'])('accepts %s', (value) => {
    expect(decimalAmountProblem(value, energy)).toBeNull();
  });

  it.each([
    ['a JSON number', 4],
    ['null', null],
    ['an empty string', ''],
    ['whitespace around the number', ' 4.000'],
    ['NaN', 'NaN'],
    ['Infinity', 'Infinity'],
    ['an exponent', '4e3'],
    ['a leading plus', '+4.000'],
    ['an empty fraction', '4.'],
    ['a thousands separator', '1,000'],
    ['more precision than the column stores', '4.0001'],
    ['a negative amount', '-1.000'],
    ['zero where the minimum is above zero', '0.000'],
    ['more than the maximum', '1000000.001'],
    ['letters', 'four'],
  ])('rejects %s', (_label, value) => {
    expect(decimalAmountProblem(value, energy)).not.toBeNull();
  });

  it('says what was wrong', () => {
    expect(decimalAmountProblem(4, energy)).toContain('not a JSON number');
    expect(decimalAmountProblem('4.0001', energy)).toContain('at most 3 decimal places');
    expect(decimalAmountProblem('-1', energy)).toContain('between');
  });
});
