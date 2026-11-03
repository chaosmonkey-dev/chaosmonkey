import { createApp } from 'vue'
import { createPinia } from 'pinia'
import App from './App.vue'
import router from './router'
import './style.css'
import './styles/cmTiles.css'

// PHASE 4: Dev server stability - fail fast on stale builds + boot logging
if (import.meta.env.DEV) {
  // PHASE 4: Get server start timestamp and build info
  import('./lib/dev/codeFreshness').then(({ verifyCodeFreshnessOnLoad, checkCodeFreshness, SERVER_START_TIMESTAMP, BUILD_VERSION }) => {
    const buildId = BUILD_VERSION || 'dev';
    const serverStart = SERVER_START_TIMESTAMP;
    
  // PHASE 4: Try to get git short SHA (from Vite env, optional)
  const gitShortSha = (import.meta as any).env?.VITE_GIT_SHA?.substring(0,7) || 'unknown';
  const buildTime = (import.meta as any).env?.VITE_BUILD_TIME || null;
    
    // PHASE 4: Check if Vite HMR is connected
    const viteHMRConnected = typeof window !== 'undefined' && 
      (window as any).__VITE_IS_MODERN_BROWSER !== undefined ||
      document.querySelector('script[type="module"][src*="@vite/client"]') !== null;
    
    // PHASE 4: Log [FRONTEND_BOOT] once on boot
    console.info('[FRONTEND_BOOT]', {
      buildId,
      serverStart,
      gitShortSha,
      buildTime,
      viteHMRConnected: viteHMRConnected ? 'connected' : 'not detected'
    });
    
    verifyCodeFreshnessOnLoad();
    
    // Fail fast: Check if build stamp matches expected
    const check = checkCodeFreshness();
    const expectedBuild = 'PI_V2_PATCH_2026_01_04_2022';
    
    // If build is stale or version mismatch, show error
    if (!check.isFresh || (buildId !== 'dev' && !buildId.includes('PI_V2'))) {
      console.error('%c⚠️ STALE BUILD DETECTED', 'color: red; font-weight: bold; font-size: 16px;');
      console.error(`Build age: ${check.ageMinutes} minutes`);
      console.error(`Expected: ${expectedBuild}, Got: ${buildId}`);
      console.error('Action: Restart dev server with: cd frontend && npm run dev:clean');
    }
  }).catch(() => {
    // If freshness check fails, still log that frontend loaded
    console.warn('[FRONTEND] Code freshness check unavailable');
  });
}

// DEV MODE: Bootstrap a dev verification token if none exists.
// Uses the existing /api/dev/verification-auth endpoint (guarded by
// CM_ENABLE_DEV_VERIFICATION_AUTH=true + local/testing env on the backend).
// This is the narrowest existing supported path — no auth bypass, no
// production weakening. The token goes through the same SimpleTokenAuth
// validation as any other bearer token.
//
// CR4 FIX (Aug 18): The bootstrap MUST complete before app.mount() so that
// API calls have the token available. Previously the fetch was fire-and-forget
// and app.mount() ran immediately, causing a race where all initial API
// calls fired without auth (401).
async function bootstrapDevAuth(): Promise<void> {
  if (!import.meta.env.DEV) return;
  if (localStorage.getItem('api_token')) {
    console.info('[DEV_AUTH] Existing token found in localStorage, skipping bootstrap');
    return;
  }

  const BASE_URL = (import.meta.env.VITE_API_BASE_URL || window.location.origin)
    .replace(/\/$/, '')
    .replace(/\/api$/, '');

  try {
    const r = await fetch(`${BASE_URL}/api/dev/verification-auth`);
    if (!r.ok) throw new Error(`dev-auth HTTP ${r.status}`);
    const data = await r.json();
    if (data?.token) {
      localStorage.setItem('api_token', data.token);
      if (data.token_storage_keys?.includes('auth_token')) {
        localStorage.setItem('auth_token', data.token);
      }
      console.info('[DEV_AUTH] Bootstrapped dev verification token', {
        user: data.user?.email,
        org: data.verification?.organizationId,
        telemetryEvents: data.verification?.telemetryEventsCount,
        distinctSessions: data.verification?.distinctSessionCount,
      });
    } else {
      console.warn('[DEV_AUTH] Dev token bootstrap failed — no token in response');
    }
  } catch (err: any) {
    console.warn('[DEV_AUTH] Dev token bootstrap failed — API calls will require manual auth', err.message);
  }
}

// Temporary sentinel: proves the browser executes this exact main.ts source.
// Remove after Matt browser acceptance.
console.info('[FRONTEND_BOOT] LOCAL_ENTRYPOINT_PROOF_2026_08_18_MAIN_TS_ACTIVE')

const app = createApp(App)
const pinia = createPinia()

// CR-X 17G.8: capture the cold-entry dashboard surface BEFORE app.use(router)
// fires the router's initial navigation. On an unauthenticated entry the
// guard redirects /dashboards → /login and window.location.hash is lost
// before Dashboards can read it; the stash lets the first Dashboards mount
// recover the surface the user actually entered with.
try {
  if (window.location.hash === '#productivity') {
    sessionStorage.setItem('cm_entry_surface_hash', '#productivity')
  }
} catch {}

app.use(pinia)
app.use(router)

// Initialize preferences at startup
import { usePreferencesStore } from './stores/preferences'
const prefs = usePreferencesStore()
prefs.initialize?.()

// CR4 FIX: Await dev auth bootstrap BEFORE mounting the app.
// This ensures the token is in localStorage before any API call fires.
bootstrapDevAuth().finally(() => {
  app.mount('#app')
});

// Global debug flag for Performance Insights verbose logging
(window as any).CM_PI_DEBUG = false

/* DEV ONLY: expose insights harness when the feature flag is enabled */
try {
  if (import.meta.env.VITE_FEATURE_PERF_INSIGHTS === '1') {
    Promise.all([
      import('@/stores/github'),
      import('@/stores/metricsFacade'),
      import('@/stores/unified'),
      import('@/lib/insights/harness'),
      import('@/lib/insights/final/test-harness'),
    ]).then(([ghMod, metMod, uniMod, harnessMod, testHarnessMod]) => {
      const useGitHubStore = (ghMod as any).useGitHubStore;
      const useMetricsFacadeStore = (metMod as any).useMetricsFacadeStore;
      const useUnifiedStore = (uniMod as any).useUnifiedStore;

      const github = useGitHubStore();
      const metrics = useMetricsFacadeStore();
      const unified = useUnifiedStore();

      // read-only-ish handles for quick access in console
      Object.defineProperty(window as any, '$stores', {
        value: { github, metrics, unified },
        writable: false,
      });

      // generic runner: pass arrays explicitly
      (window as any).__perfInsights = (githubWeekly: any[], productivityWeekly: any[]) => {
        try {
          const githubSnapshot = (github as any)?.rawResponse
          return harnessMod.runPerfInsightsHarness({
            githubWeekly,
            productivityWeekly,
            granularity: 'week',
            githubSnapshot,
          });
        } catch (e) {
          console.error('[perf-insights] harness error:', e);
          return [];
        }
      };

      // convenience runner: uses current store arrays
      (window as any).__perfFromStores = () => {
        const ghWeekly =
          github?.metricsHistory?.weekly ?? github?.filteredWeekly ?? [];
        const prodWeekly =
          metrics?.productivityHistory?.weekly ?? metrics?.history?.weekly ?? [];
        return (window as any).__perfInsights(ghWeekly, prodWeekly);
      };

      // Expose PI inspector
      (window as any).inspectFinalPIOutput = testHarnessMod.inspectFinalPIOutput;

      console.info(
        '[perf-insights] dev globals ready:',
        '__perfInsights(githubWeekly, productivityWeekly)',
        'and',
        '__perfFromStores()',
        'and',
        'inspectFinalPIOutput()',
        '— behind VITE_FEATURE_PERF_INSIGHTS=1'
      );
    }).catch(() => {});
  }
} catch {}
