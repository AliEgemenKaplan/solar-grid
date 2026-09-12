import { PricesService } from '../src/prices/prices.service';

const defaultRule = { basePrice: 4.0, minPrice: 2.5, maxPrice: 7.0 };

describe('PricesService.calculatePrice', () => {
  it('should calculate price correctly with balanced supply and demand', () => {
    const price = PricesService.calculatePrice(40, 40, defaultRule);
    expect(price).toBe(4.0);
  });

  it('should increase price when demand exceeds supply', () => {
    const price = PricesService.calculatePrice(20, 40, defaultRule);
    expect(price).toBeGreaterThan(4.0);
  });

  it('should decrease price when supply exceeds demand', () => {
    const price = PricesService.calculatePrice(80, 20, defaultRule);
    expect(price).toBeLessThan(4.0);
  });

  it('should clamp to minPrice when supply >> demand', () => {
    const price = PricesService.calculatePrice(1000, 1, defaultRule);
    expect(price).toBe(defaultRule.minPrice);
  });

  it('should clamp to maxPrice when demand >> supply', () => {
    const price = PricesService.calculatePrice(1, 1000, defaultRule);
    expect(price).toBe(defaultRule.maxPrice);
  });

  it('should handle zero supply (use max(supply, 1) to avoid division by zero)', () => {
    const price = PricesService.calculatePrice(0, 40, defaultRule);
    expect(price).toBe(defaultRule.maxPrice);
  });

  it('should handle zero demand (price approaches 0 but clamps to minPrice)', () => {
    const price = PricesService.calculatePrice(50, 0, defaultRule);
    expect(price).toBe(defaultRule.minPrice);
  });

  it('should respect custom min/max bounds', () => {
    const customRule = { basePrice: 5.0, minPrice: 1.0, maxPrice: 10.0 };
    const price = PricesService.calculatePrice(50, 40, customRule);
    expect(price).toBeGreaterThanOrEqual(customRule.minPrice);
    expect(price).toBeLessThanOrEqual(customRule.maxPrice);
  });
});
