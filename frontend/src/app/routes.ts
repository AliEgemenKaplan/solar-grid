/**
 * The control center's views. One page each, reached from the navigation or
 * by address (`#/market`), so the browser's back button and a shared link
 * both work without a router library.
 */
export type PageId =
  'overview' | 'energy' | 'market' | 'trading' | 'billing' | 'households' | 'system';

export interface PageDefinition {
  id: PageId;
  label: string;
  /** What the page answers, in a sentence, for its heading. */
  question: string;
}

export const PAGES: readonly PageDefinition[] = [
  { id: 'overview', label: 'Overview', question: 'Is the grid healthy, and what is it doing?' },
  { id: 'energy', label: 'Energy', question: 'How much energy is produced and used, and when?' },
  { id: 'market', label: 'Market', question: 'What does energy cost, and why?' },
  { id: 'trading', label: 'Trading', question: 'Which offers and requests became trades?' },
  { id: 'billing', label: 'Billing', question: 'What was settled, and do the books balance?' },
  { id: 'households', label: 'Households', question: 'Who produces, uses, sells and buys?' },
  {
    id: 'system',
    label: 'System health',
    question: 'Is every service working, and what is it doing?',
  },
];

export function isPageId(value: string): value is PageId {
  return PAGES.some((page) => page.id === value);
}

export function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#\/?/, '').split(/[/?]/)[0] ?? '';
  return isPageId(id) ? id : 'overview';
}

export function hashFor(page: PageId): string {
  return `#/${page}`;
}
