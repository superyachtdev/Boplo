import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateMoveBudget } from '../functions/move/[[path]].js';

test('move calculator is transparent about first-month and three-month totals', () => {
  const result = calculateMoveBudget({
    destination: 'Lisbon, Portugal', currency: 'eur', monthlyRent: 1000,
    depositMonths: 1.5, monthlyLiving: 550, travelAndSetup: 300,
    emergencyBuffer: 500, savings: 4000
  });
  assert.equal(result.currency, 'EUR');
  assert.equal(result.deposit, 1500);
  assert.equal(result.firstMonthTotal, 3850);
  assert.equal(result.threeMonthTotal, 6950);
  assert.equal(result.remainingAfterFirstMonth, 150);
  assert.equal(result.gapToFirstMonth, 0);
});

test('move calculator returns the shortfall instead of hiding an unaffordable estimate', () => {
  const result = calculateMoveBudget({
    destination: 'Montreal, Canada', currency: 'CAD', monthlyRent: 1500,
    depositMonths: 0, monthlyLiving: 700, travelAndSetup: 800,
    emergencyBuffer: 500, savings: 2100
  });
  assert.equal(result.firstMonthTotal, 3500);
  assert.equal(result.remainingAfterFirstMonth, -1400);
  assert.equal(result.gapToFirstMonth, 1400);
});

test('move calculator rejects impossible financial input', () => {
  assert.throws(() => calculateMoveBudget({ destination: 'Paris', monthlyRent: -1 }), /monthly rent/);
  assert.throws(() => calculateMoveBudget({ destination: 'Paris', monthlyRent: 500, depositMonths: 20 }), /deposit/);
  assert.throws(() => calculateMoveBudget({ destination: '', monthlyRent: 500 }), /destination/);
});
