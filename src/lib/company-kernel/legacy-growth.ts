export const LEGACY_GROWTH_READ_ONLY_REASON =
  'Growth proposal automation has been retired. Use /api/company/self-improvement/* for new improvement work.';

export function buildLegacyGrowthReadOnlyPayload(action: string): {
  error: string;
  legacyMode: 'read-only';
  requestedAction: string;
  replacement: string;
} {
  return {
    error: LEGACY_GROWTH_READ_ONLY_REASON,
    legacyMode: 'read-only',
    requestedAction: action,
    replacement: '/api/company/self-improvement/proposals',
  };
}
