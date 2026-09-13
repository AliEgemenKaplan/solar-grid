import { PricesService } from '../src/prices/prices.service';

const calculate = PricesService.calculatePrice;
const band = { basePrice: '4.0000', minPrice: '2.5000', maxPrice: '7.0000' };

describe('PricesService.calculatePrice', () => {
  it('returns the base price when supply and demand are equal', () => {
    expect(calculate(50, 50, band)).toBe('4.0000');
  });

  it('raises the price when demand exceeds supply', () => {
    // 4 * 60/40 = 6
    expect(calculate(40, 60, band)).toBe('6.0000');
  });

  it('lowers the price when supply exceeds demand', () => {
    // 4 * 40/80 = 2, below the floor
    expect(calculate(80, 40, band)).toBe('2.5000');
  });

  it('clamps to the floor when supply dwarfs demand', () => {
    expect(calculate(1000, 1, band)).toBe('2.5000');
  });

  it('clamps to the ceiling when demand dwarfs supply', () => {
    expect(calculate(1, 1000, band)).toBe('7.0000');
  });

  it('treats zero supply as one to avoid dividing by zero', () => {
    expect(calculate(0, 2, band)).toBe('7.0000');
  });

  it('clamps zero demand up to the floor', () => {
    expect(calculate(50, 0, band)).toBe('2.5000');
  });

  it('respects a custom band', () => {
    expect(calculate(40, 60, { basePrice: '1.0000', minPrice: '0.5000', maxPrice: '1.2000' })).toBe(
      '1.2000',
    );
  });

  it('divides exactly rather than accumulating binary error', () => {
    // 4 * 10/3 = 13.33... clamped to the ceiling; the point is that the
    // division is decimal, not a double.
    expect(calculate(3, 10, band)).toBe('7.0000');
    // 3 * 1/3 = 1 exactly, where 3 * (1/3) as doubles is 0.9999999999999998.
    expect(calculate(3, 1, { basePrice: '3.0000', minPrice: '0.0001', maxPrice: '9.0000' })).toBe(
      '1.0000',
    );
  });

  it('rounds half up at the fourth decimal', () => {
    // 1 * 1/3 = 0.33333... -> 0.3333
    expect(calculate(3, 1, { basePrice: '1.0000', minPrice: '0.0001', maxPrice: '9.0000' })).toBe(
      '0.3333',
    );
    // 2 * 1/3 = 0.66666... -> 0.6667
    expect(calculate(3, 1, { basePrice: '2.0000', minPrice: '0.0001', maxPrice: '9.0000' })).toBe(
      '0.6667',
    );
  });

  it('accepts numbers and decimal strings alike', () => {
    expect(calculate('40.000', '60.000', band)).toBe('6.0000');
  });
});
