export type View = 'overview' | 'forecast' | 'coverage';

/**
 * Only destinations that exist.
 *
 * Carriers, Lanes and Clients used to sit here disabled, with a tooltip
 * explaining that the Breakdown tile's dimension switcher already covers them.
 * A control that is permanently disabled is worse than no control: it reads as
 * something broken rather than something deliberately absent.
 */
export const VIEWS: { id: View; label: string }[] = [
  { id: 'overview', label: 'Overview' },
  { id: 'forecast', label: 'Forecast' },
  { id: 'coverage', label: 'Coverage' },
];
