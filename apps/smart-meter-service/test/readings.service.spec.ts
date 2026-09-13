import { EnergyStatus, ReadingsService } from '../src/readings/readings.service';

const calculate = ReadingsService.calculateEnergyStatus;

describe('ReadingsService.calculateEnergyStatus', () => {
  it('reports a surplus when production exceeds consumption', () => {
    expect(calculate(10, 3)).toEqual({
      status: EnergyStatus.SURPLUS,
      netKwh: '7.000',
      surplusKwh: '7.000',
      demandKwh: '0.000',
    });
  });

  it('reports demand when consumption exceeds production', () => {
    expect(calculate(1, 5)).toEqual({
      status: EnergyStatus.DEMAND,
      netKwh: '-4.000',
      surplusKwh: '0.000',
      demandKwh: '4.000',
    });
  });

  it('reports balanced when the two are equal', () => {
    expect(calculate(5, 5)).toEqual({
      status: EnergyStatus.BALANCED,
      netKwh: '0.000',
      surplusKwh: '0.000',
      demandKwh: '0.000',
    });
  });

  it('handles a household that produces nothing', () => {
    expect(calculate(0, 4.5)).toMatchObject({
      status: EnergyStatus.DEMAND,
      demandKwh: '4.500',
    });
  });

  it('handles a household that consumes nothing', () => {
    expect(calculate(8.25, 0)).toMatchObject({
      status: EnergyStatus.SURPLUS,
      surplusKwh: '8.250',
    });
  });

  it('subtracts exactly, where floating point would not', () => {
    // 0.3 - 0.1 is 0.19999999999999998 as a double.
    expect(calculate(0.3, 0.1)).toMatchObject({ surplusKwh: '0.200', netKwh: '0.200' });
    // 1.005 - 1.0 is 0.004999999999999893 as a double.
    expect(calculate(1.005, 1)).toMatchObject({ surplusKwh: '0.005' });
    expect(calculate(0.1, 0.3)).toMatchObject({ demandKwh: '0.200' });
  });

  it('accepts decimal strings as well as numbers', () => {
    expect(calculate('10.000', '3.000')).toMatchObject({ surplusKwh: '7.000' });
    expect(calculate('0.0003', '0')).toMatchObject({ surplusKwh: '0.000', netKwh: '0.000' });
  });

  it('keeps watt hour resolution and rounds half away from zero', () => {
    expect(calculate(1.2345, 1)).toMatchObject({ surplusKwh: '0.235' });
    expect(calculate(1.2355, 1)).toMatchObject({ surplusKwh: '0.236' });
    expect(calculate(1, 1.2345)).toMatchObject({ demandKwh: '0.235' });
  });

  it('matches the demo scenario', () => {
    expect(calculate(10, 3)).toMatchObject({ status: EnergyStatus.SURPLUS, surplusKwh: '7.000' });
    expect(calculate(1, 5)).toMatchObject({ status: EnergyStatus.DEMAND, demandKwh: '4.000' });
  });
});
