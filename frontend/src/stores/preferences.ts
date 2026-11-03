import { defineStore } from 'pinia'
import { buildRegistry, splitByDashboard, defaultSelectedIds } from '../config/metricsRegistry'

export type MetricId = string

const KEYS = {
  ids: 'prefs.selectedMetricIds',
  ts:  'prefs.lastUpdatedAt',
};

function unique(arr: string[]) { return Array.from(new Set(arr)); }

export const usePreferencesStore = defineStore('preferences', {
  state: () => ({
    registry: buildRegistry() as ReturnType<typeof buildRegistry>,
    selectedMetricIds: [] as MetricId[],
    lastUpdatedAt: null as string | null,
  }),
  getters: {
    selectedByDashboard(state) {
      const buckets = splitByDashboard(state.registry);
      const has = (id: string) => state.selectedMetricIds.includes(id);
      return {
        productivity: buckets.productivity.filter(m => has(m.id)).map(m => m.id),
        eng:          buckets.eng.filter(m => has(m.id)).map(m => m.id),
        ide:          buckets.ide.filter(m => has(m.id)).map(m => m.id),
        other:        buckets.other.filter(m => has(m.id)).map(m => m.id),
      };
    },
    isMetricSelected: (state) => (id: MetricId) => state.selectedMetricIds.includes(id),
    allMetrics: (state) => state.registry,
  },
  actions: {
    initialize() {
      // Build/refresh registry (in case code changed)
      this.registry = buildRegistry();
      // Load persisted selection
      this.loadFromStorage();
      // Merge in any new metrics (opt-in-by-default if defaultSelected===true)
      const defaults = defaultSelectedIds(this.registry);
      const knownIds = this.registry.map(m => m.id);
      const current = new Set(this.selectedMetricIds.filter(id => knownIds.includes(id)));
      // Add defaultSelected that aren't chosen yet
      defaults.forEach(id => current.add(id));
      // If user has zero selections (first run), select all defaultSelected.
      if (current.size === 0) defaults.forEach(id => current.add(id));
      this.selectedMetricIds = unique(Array.from(current));
      this.lastUpdatedAt = this.lastUpdatedAt ?? new Date().toISOString();
      this.saveToStorage();
    },
    setSelectedMetrics(ids: MetricId[]) {
      const knownIds = new Set(this.registry.map(m => m.id));
      this.selectedMetricIds = unique(ids.filter(id => knownIds.has(id)));
      this.lastUpdatedAt = new Date().toISOString();
      this.saveToStorage();
    },
    selectAll(dashboard?: 'productivity'|'eng'|'ide'|'other') {
      const ids = dashboard
        ? this.registry.filter(m => m.dashboard === dashboard).map(m => m.id)
        : this.registry.map(m => m.id);
      this.setSelectedMetrics(unique([...this.selectedMetricIds, ...ids]));
    },
    deselectAll(dashboard?: 'productivity'|'eng'|'ide'|'other') {
      const toDrop = new Set(
        dashboard
          ? this.registry.filter(m => m.dashboard === dashboard).map(m => m.id)
          : this.registry.map(m => m.id)
      );
      this.selectedMetricIds = this.selectedMetricIds.filter(id => !toDrop.has(id));
      this.lastUpdatedAt = new Date().toISOString();
      this.saveToStorage();
    },
    loadFromStorage() {
      try {
        const raw = sessionStorage.getItem(KEYS.ids);
        if (raw) {
          const ids = JSON.parse(raw);
          if (Array.isArray(ids)) this.selectedMetricIds = unique(ids);
        }
        const ts = sessionStorage.getItem(KEYS.ts);
        if (ts) this.lastUpdatedAt = ts;
      } catch {/* no-op */}
    },
    saveToStorage() {
      try {
        sessionStorage.setItem(KEYS.ids, JSON.stringify(this.selectedMetricIds));
        sessionStorage.setItem(KEYS.ts, this.lastUpdatedAt ?? '');
      } catch {/* no-op */}
    },
  },
});
