export type View = 'overview' | 'forecast' | 'coverage';

export const VIEWS: { id: View | string; label: string; enabled: boolean; hint?: string }[] = [
  { id: 'overview', label: 'Overview', enabled: true },
  { id: 'forecast', label: 'Forecast', enabled: true },
  { id: 'coverage', label: 'Coverage', enabled: true },
  { id: 'carriers', label: 'Carriers', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers carriers.' },
  { id: 'lanes', label: 'Lanes', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers lanes.' },
  { id: 'clients', label: 'Clients', enabled: false, hint: 'Use the Breakdown tile — its dimension switcher covers clients.' },
];
