import { ReadingsService, EnergyStatus } from '../src/readings/readings.service';

describe('ReadingsService.calculateEnergyStatus', () => {
  it('should return SURPLUS when production > consumption', () => {
    const result = ReadingsService.calculateEnergyStatus(8.5, 3.2);
    expect(result.status).toBe(EnergyStatus.SURPLUS);
    expect(result.netKwh).toBeCloseTo(5.3);
    expect(result.surplusKwh).toBeCloseTo(5.3);
    expect(result.demandKwh).toBe(0);
  });

  it('should return DEMAND when consumption > production', () => {
    const result = ReadingsService.calculateEnergyStatus(1, 5);
    expect(result.status).toBe(EnergyStatus.DEMAND);
    expect(result.netKwh).toBeCloseTo(-4);
    expect(result.surplusKwh).toBe(0);
    expect(result.demandKwh).toBeCloseTo(4);
  });

  it('should return BALANCED when production === consumption', () => {
    const result = ReadingsService.calculateEnergyStatus(4, 4);
    expect(result.status).toBe(EnergyStatus.BALANCED);
    expect(result.netKwh).toBe(0);
    expect(result.surplusKwh).toBe(0);
    expect(result.demandKwh).toBe(0);
  });

  it('should handle zero production', () => {
    const result = ReadingsService.calculateEnergyStatus(0, 3);
    expect(result.status).toBe(EnergyStatus.DEMAND);
    expect(result.demandKwh).toBe(3);
  });

  it('should handle zero consumption', () => {
    const result = ReadingsService.calculateEnergyStatus(5, 0);
    expect(result.status).toBe(EnergyStatus.SURPLUS);
    expect(result.surplusKwh).toBe(5);
  });

  it('should calculate correct demandKwh from demo scenario (HH-BUYER-001)', () => {
    const result = ReadingsService.calculateEnergyStatus(1, 5);
    expect(result.demandKwh).toBe(4);
  });

  it('should calculate correct surplusKwh from demo scenario (HH-SELLER-001)', () => {
    const result = ReadingsService.calculateEnergyStatus(10, 3);
    expect(result.surplusKwh).toBe(7);
  });
});
