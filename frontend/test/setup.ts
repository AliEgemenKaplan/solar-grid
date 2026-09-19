import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

// jsdom has no layout and no ResizeObserver. Left without one, Recharts'
// ResponsiveContainer keeps the initial size each chart is given instead of
// measuring a 0 x 0 box, so the charts render their SVG in tests.

afterEach(() => {
  cleanup();
  sessionStorage.clear();
});
