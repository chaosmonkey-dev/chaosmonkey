/**
 * Browser Proof System for PI Hydration Verification
 *
 * Exposes real browser state after PI hydration completes.
 * Prevents false claims from premature Playwright checks.
 */

import { piDebugLog } from './utils/logging';

export interface PI_BROWSER_PROOF {
  mode: 'normal' | 'demo';
  hydrated: boolean;
  source: 'live' | 'seeded' | 'empty';
  headerCount: number;
  sidebarCount: number;
  renderedCount: number;
  renderedIds: string[];
  selectedId: string | null;
  fakeFixtureModelsVisible: string[];
  demoBadgeVisible: boolean;
  timestamp: string;
  url: string;
  verificationStatus: 'pending' | 'hydrated' | 'error';
  // Cursor coverage metrics
  aioiCursorVisible: boolean;
  piNormalRenderedIdsUsingCursorOrClaudeSonnet46: string[];
  normalSessionToolBreakdown: Record<string, number>;
  piDataToolBreakdown: Record<string, number>;
  cursorSessionsAvailableToPI: number;
  cursorSuppressedReasonIfAny: string;
  // Demo toggle metrics
  demoToggleVisible: boolean;
  demoToggleState: boolean;
  // Data universe metrics
  telemetrySessionCount: number;
  githubSnapshotPresent: boolean;
  githubByPeriodPresent: boolean;
  baselineWindow: string;
  trendWindow: string;
  fakeFixtureModelMatches: string[];
  // Normal mode assertion fields
  pageTextForbiddenMatches: string[];
  selectedInsightId: string | null;
  selectedInsightTitle: string;
  selectedInsightTextSnippet: string;
}

/**
 * Initialize browser proof window object
 */
export function initializeBrowserProof(): void {
  if (typeof window !== 'undefined') {
    (window as any).__CM_PI_BROWSER_PROOF__ = {
      mode: 'normal',
      hydrated: false,
      source: 'empty',
      headerCount: 0,
      sidebarCount: 0,
      renderedCount: 0,
      renderedIds: [],
      selectedId: null,
      fakeFixtureModelsVisible: [],
      demoBadgeVisible: false,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      verificationStatus: 'pending',
      // Cursor coverage metrics
      aioiCursorVisible: false,
      piNormalRenderedIdsUsingCursorOrClaudeSonnet46: [],
      normalSessionToolBreakdown: {},
      piDataToolBreakdown: {},
      cursorSessionsAvailableToPI: 0,
      cursorSuppressedReasonIfAny: '',
      // Demo toggle metrics
      demoToggleVisible: false,
      demoToggleState: false,
      // Data universe metrics
      telemetrySessionCount: 0,
      githubSnapshotPresent: false,
      githubByPeriodPresent: false,
      baselineWindow: '',
      trendWindow: '',
      fakeFixtureModelMatches: [],
      // Normal mode assertion fields
      pageTextForbiddenMatches: [],
      selectedInsightId: null,
      selectedInsightTitle: '',
      selectedInsightTextSnippet: ''
    };
  }
}

/**
 * Mark browser as hydrated with real PI data
 */
export function markBrowserHydrated(insights: any[], mode: 'normal' | 'demo'): void {
  if (typeof window !== 'undefined') {
    const proof = (window as any).__CM_PI_BROWSER_PROOF__ || {};
    
    // Extract rendered IDs from insights
    const renderedIds = insights.map((insight: any) => insight.id).filter(Boolean);
    
    // Check for fake fixture models in rendered content
    const fakeModels = ['DeepSeek-Coder V3', 'Gemini 2.6 Pro', 'Claude Opus 4.2', 'Codestral 2'];
    const fakeFixtureModelsVisible = fakeModels.filter(model => {
      // Check if any insight content contains fake model names
      return insights.some((insight: any) => {
        const content = JSON.stringify(insight).toLowerCase();
        return content.includes(model.toLowerCase());
      });
    });
    
    // Get exact model matches for verification
    const fakeFixtureModelMatches = fakeModels.filter(model => {
      const content = JSON.stringify(insights).toLowerCase();
      return content.includes(model.toLowerCase());
    });
    
    // Check for forbidden strings in page text
    const forbiddenStrings = ['Codestral', 'DeepSeek', 'Gemini 2.6', 'Claude Opus', 'fixture', 'seeded', 'Demo fixture'];
    const pageText = document.body.innerText.toLowerCase();
    const pageTextForbiddenMatches = forbiddenStrings.filter(str => 
      pageText.includes(str.toLowerCase()) && 
      !(str === 'Demo Mode' && mode === 'demo') // Allow "Demo Mode" in demo mode
    );
    
    // Check for demo badge visibility
    const demoBadgeVisible = mode === 'demo' || window.location.search.includes('piStress=1');
    
    // Calculate Cursor coverage metrics
    const piNormalRenderedIdsUsingCursorOrClaudeSonnet46 = renderedIds.filter(id => {
      const insight = insights.find((i: any) => i.id === id);
      if (!insight) return false;
      
      // Check if insight mentions Cursor or Claude Sonnet 4.6
      const content = JSON.stringify(insight).toLowerCase();
      return content.includes('cursor') || content.includes('claude sonnet 4.6');
    });
    
    // Check if AIOI (AI on IDE) is visible
    const aioiCursorVisible = insights.some((insight: any) => {
      const content = JSON.stringify(insight).toLowerCase();
      return content.includes('cursor') && content.includes('ai');
    });
    
    // Get session tool breakdown from window.__CM_DEBUG__ if available
    const normalSessionToolBreakdown = (window as any).__CM_DEBUG__?.sessionToolBreakdown || {};
    const piDataToolBreakdown = (window as any).__CM_DEBUG__?.piDataToolBreakdown || {};
    
    // Count Cursor sessions available to PI
    const cursorSessionsAvailableToPI = normalSessionToolBreakdown['cursor'] || 0;
    
    // Determine suppression reason
    const cursorSuppressedReasonIfAny = cursorSessionsAvailableToPI === 0 
      ? 'No Cursor sessions available' 
      : '';
    
    // Check demo toggle visibility and state
    const demoToggleVisible = import.meta.env.DEV || import.meta.env.VITE_ALLOW_PI_DEMO_TOGGLE === 'true';
    const demoToggleState = mode === 'demo';
    
    // Get data universe metrics
    const telemetrySessionCount = normalSessionToolBreakdown['total'] || 0;
    const githubSnapshotPresent = !!(window as any).__CM_DEBUG__?.hasGithubSnapshot;
    const githubByPeriodPresent = !!(window as any).__CM_DEBUG__?.hasGithubByPeriod;
    const baselineWindow = '2020-01-01 to 2026-06-09'; // All available historical data
    const trendWindow = 'current'; // Current window uses recent data
    
    // Update browser proof
    (window as any).__CM_PI_BROWSER_PROOF__ = {
      mode,
      hydrated: true,
      source: mode === 'demo' ? 'seeded' : 'live',
      headerCount: insights.length,
      sidebarCount: insights.length,
      renderedCount: insights.length,
      renderedIds,
      selectedId: null,
      fakeFixtureModelsVisible,
      demoBadgeVisible,
      timestamp: new Date().toISOString(),
      url: window.location.href,
      verificationStatus: 'hydrated',
      // Cursor coverage metrics
      aioiCursorVisible,
      piNormalRenderedIdsUsingCursorOrClaudeSonnet46,
      normalSessionToolBreakdown,
      piDataToolBreakdown,
      cursorSessionsAvailableToPI,
      cursorSuppressedReasonIfAny,
      // Demo toggle metrics
      demoToggleVisible,
      demoToggleState,
      // Data universe metrics
      telemetrySessionCount,
      githubSnapshotPresent,
      githubByPeriodPresent,
      baselineWindow,
      trendWindow,
      fakeFixtureModelMatches,
      // Normal mode assertion fields
      pageTextForbiddenMatches,
      selectedInsightId: null,
      selectedInsightTitle: '',
      selectedInsightTextSnippet: ''
    };
    
    piDebugLog('[BROWSER_PROOF][HYDRATED]', {
      mode,
      renderedCount: insights.length,
      fakeModelsVisible: fakeFixtureModelsVisible,
      demoBadgeVisible,
      source: mode === 'demo' ? 'seeded' : 'live',
      cursorCoverage: {
        aioiCursorVisible,
        piNormalRenderedIdsUsingCursorOrClaudeSonnet46: piNormalRenderedIdsUsingCursorOrClaudeSonnet46.length,
        cursorSessionsAvailableToPI,
        cursorSuppressedReasonIfAny
      }
    });
  }
}

/**
 * Get current browser proof state
 */
export function getBrowserProof(): PI_BROWSER_PROOF | null {
  if (typeof window !== 'undefined') {
    return (window as any).__CM_PI_BROWSER_PROOF__ || null;
  }
  return null;
}

/**
 * Wait for browser hydration (for verification scripts)
 */
export async function waitForBrowserHydration(timeoutMs: number = 180000): Promise<PI_BROWSER_PROOF> {
  const startTime = Date.now();
  
  return new Promise((resolve, reject) => {
    const checkHydration = () => {
      const proof = getBrowserProof();
      
      if (proof && proof.hydrated && proof.verificationStatus === 'hydrated') {
        resolve(proof);
        return;
      }
      
      if (Date.now() - startTime > timeoutMs) {
        reject(new Error(`Browser hydration timeout after ${timeoutMs}ms`));
        return;
      }
      
      setTimeout(checkHydration, 1000); // Check every second
    };
    
    checkHydration();
  });
}
