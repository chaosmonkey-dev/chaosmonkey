// Rule execution diagnostics for Performance Insights
// Enable with: CHAOSMONKEY_RULE_DIAG=1 or VITE_RULE_DIAG=1
// Relax guards with: VITE_RELAX_GUARDS=1 or CHAOSMONKEY_RELAX_GUARDS=1

type RuleKey = string;
type ReasonCode = 'GUARD_FAIL' | 'NO_DATA' | 'STATS_TOO_WEAK' | 'EMPTY_RESULT' | 'EXCEPTION';

 type GuardAuditRecord = {
   reason: string;
   evidence?: Record<string, any>;
 };

 // Empty Results Audit support (PI_DEBUG-only, independent of VITE_RULE_DIAG)
 let activeRuleKeyForAudit: RuleKey | null = null;
 const lastGuardFailByRuleKey: Map<RuleKey, GuardAuditRecord> = new Map();

 function isPiDebugEnabled(): boolean {
   const v = (import.meta as any).env?.VITE_PI_DEBUG ?? 'false';
   return v === 'true' || v === '1';
 }

 export function setActiveRuleKeyForAudit(ruleKey: RuleKey | null): void {
   if (!isPiDebugEnabled()) return;
   activeRuleKeyForAudit = ruleKey;
 }

 export function clearGuardAuditForRule(ruleKey: RuleKey): void {
   if (!isPiDebugEnabled()) return;
   lastGuardFailByRuleKey.delete(ruleKey);
 }

 export function getLastGuardFailForRule(ruleKey: RuleKey): GuardAuditRecord | undefined {
   if (!isPiDebugEnabled()) return undefined;
   return lastGuardFailByRuleKey.get(ruleKey);
 }

 function recordGuardFail(reason: string, evidence?: Record<string, any>): void {
   if (!isPiDebugEnabled()) return;
   const rk = activeRuleKeyForAudit;
   if (!rk) return;
   lastGuardFailByRuleKey.set(rk, { reason, evidence });
 }

// Global relaxed guards flag (computed once)
export function isRelaxedGuardsMode(): boolean {
  return (
    ((import.meta as any).env?.VITE_RELAX_GUARDS === '1') ||
    ((import.meta as any).env?.CHAOSMONKEY_RELAX_GUARDS === '1') ||
    false
  );
}

export interface RuleEvent {
  ruleKey: RuleKey;
  fired: boolean;
  count?: number;
  reasonCode?: ReasonCode;
  details?: Record<string, any>;
  ctxSummary?: Record<string, any>;
}

class RuleDiagnostics {
  private events: Map<RuleKey, RuleEvent> = new Map();
  private enabled: boolean;
  private missingFieldsByStage: Map<string, Set<string>> = new Map();

  constructor() {
    // Check for diagnostic flag (Vite env vars need VITE_ prefix)
    this.enabled = 
      ((import.meta as any).env?.VITE_RULE_DIAG === '1') ||
      ((import.meta as any).env?.CHAOSMONKEY_RULE_DIAG === '1') ||
      false;
  }

  diagEnabled(): boolean {
    return this.enabled;
  }

  diagRuleStart(ruleKey: RuleKey, ctxSummary: Record<string, any>): void {
    if (!this.enabled) return;
    
    this.events.set(ruleKey, {
      ruleKey,
      fired: false,
      ctxSummary: this.sanitizeContext(ctxSummary)
    });
  }

  diagRuleFired(ruleKey: RuleKey, count: number): void {
    if (!this.enabled) return;
    
    const existing = this.events.get(ruleKey);
    if (existing) {
      existing.fired = true;
      existing.count = count;
    } else {
      this.events.set(ruleKey, {
        ruleKey,
        fired: true,
        count
      });
    }
  }

  diagRuleEmpty(ruleKey: RuleKey, reasonCode: ReasonCode, details?: Record<string, any>): void {
    if (!this.enabled) return;
    
    const existing = this.events.get(ruleKey);
    if (existing) {
      existing.fired = false;
      existing.reasonCode = reasonCode;
      existing.details = this.sanitizeDetails(details);
    } else {
      this.events.set(ruleKey, {
        ruleKey,
        fired: false,
        reasonCode,
        details: this.sanitizeDetails(details)
      });
    }
  }

  diagFlushReport(): void {
    if (!this.enabled || this.events.size === 0) return;

    const fired: RuleEvent[] = [];
    const nonFired: RuleEvent[] = [];
    
    for (const event of this.events.values()) {
      if (event.fired) {
        fired.push(event);
      } else {
        nonFired.push(event);
      }
    }

    // Group non-fired by reason code
    const byReason: Record<ReasonCode, RuleEvent[]> = {
      GUARD_FAIL: [],
      NO_DATA: [],
      STATS_TOO_WEAK: [],
      EMPTY_RESULT: [],
      EXCEPTION: []
    };

    for (const event of nonFired) {
      if (event.reasonCode) {
        byReason[event.reasonCode].push(event);
      } else {
        byReason.EMPTY_RESULT.push(event);
      }
    }

    // Print compact report
    console.group('📊 [RULE_DIAG] Performance Insights Rule Health Report');
    
    console.log(`Total rules executed: ${this.events.size}`);
    console.log(`Fired: ${fired.length} | Non-fired: ${nonFired.length}`);
    
    const totalInsights = fired.reduce((sum, e) => sum + (e.count || 0), 0);
    console.log(`Total insights emitted: ${totalInsights}`);
    
    if (fired.length > 0) {
      console.group('✅ Fired Rules');
      fired
        .sort((a, b) => (b.count || 0) - (a.count || 0))
        .forEach(e => {
          console.log(`  ${e.ruleKey}: ${e.count || 0} insights`);
        });
      console.groupEnd();
    }

    if (nonFired.length > 0) {
      console.group('❌ Non-Fired Rules (by reason)');
      
      for (const [reason, events] of Object.entries(byReason)) {
        if (events.length === 0) continue;
        
        console.group(`${reason} (${events.length})`);
        
        // For GUARD_FAIL, show top missing fields
        if (reason === 'GUARD_FAIL') {
          const fieldCounts: Record<string, number> = {};
          events.forEach(e => {
            const field = e.details?.fieldName || 'unknown';
            fieldCounts[field] = (fieldCounts[field] || 0) + 1;
          });
          
          const topFields = Object.entries(fieldCounts)
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5);
          
          console.log('Top missing fields:', topFields.map(([f, c]) => `${f} (${c})`).join(', '));
        }
        
        // List affected rules (limit to 10)
        events.slice(0, 10).forEach(e => {
          const details = e.details ? ` - ${JSON.stringify(e.details).slice(0, 60)}` : '';
          console.log(`  ${e.ruleKey}${details}`);
        });
        
        if (events.length > 10) {
          console.log(`  ... and ${events.length - 10} more`);
        }
        
        console.groupEnd();
      }
      
      console.groupEnd();
    }

    // Data availability summary
    if (fired.length > 0 || nonFired.length > 0) {
      const sampleEvent = [...this.events.values()].find(e => e.ctxSummary);
      if (sampleEvent?.ctxSummary) {
        console.group('📈 Data Availability (sample)');
        Object.entries(sampleEvent.ctxSummary).forEach(([key, val]) => {
          console.log(`  ${key}: ${val}`);
        });
        console.groupEnd();
      }
    }

    // Next actions
    const missingFields = new Set<string>();
    byReason.GUARD_FAIL.forEach(e => {
      if (e.details?.fieldName) {
        missingFields.add(e.details.fieldName);
      }
    });
    
    if (missingFields.size > 0) {
      console.group('💡 Next Actions');
      console.log('Most common missing data:', Array.from(missingFields).slice(0, 3).join(', '));
      console.log('Consider:');
      console.log('  - Relaxing minimum length requirements in NON-DEMO mode');
      console.log('  - Adding fallback data sources');
      console.log('  - Making statistical thresholds adaptive based on sample size');
      console.groupEnd();
    }

    console.groupEnd();

    // Clear for next run
    this.events.clear();
  }

  getEventsSnapshot(): RuleEvent[] {
    if (!this.enabled || this.events.size === 0) return [];
    return Array.from(this.events.values()).map(e => ({
      ...e,
      details: e.details ? { ...e.details } : undefined,
      ctxSummary: e.ctxSummary ? { ...e.ctxSummary } : undefined,
    }));
  }

  private sanitizeContext(ctx: Record<string, any>): Record<string, any> {
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(ctx)) {
      if (Array.isArray(val)) {
        sanitized[key] = `array[${val.length}]`;
      } else if (typeof val === 'object' && val !== null) {
        sanitized[key] = 'object';
      } else {
        sanitized[key] = val;
      }
    }
    return sanitized;
  }

  private sanitizeDetails(details?: Record<string, any>): Record<string, any> | undefined {
    if (!details) return undefined;
    const sanitized: Record<string, any> = {};
    for (const [key, val] of Object.entries(details)) {
      if (typeof val === 'number' || typeof val === 'string' || typeof val === 'boolean') {
        sanitized[key] = val;
      } else if (Array.isArray(val)) {
        sanitized[key] = `array[${val.length}]`;
      } else {
        sanitized[key] = String(val).slice(0, 50);
      }
    }
    return sanitized;
  }
}

// Singleton instance
let diagnosticsInstance: RuleDiagnostics | null = null;

export function getDiagnostics(): RuleDiagnostics {
  if (!diagnosticsInstance) {
    diagnosticsInstance = new RuleDiagnostics();
  }
  return diagnosticsInstance;
}

// Guard helper result type for structured failure reasons
export interface GuardResult {
  pass: boolean;
  reason?: {
    fieldName: string;
    have: number | string;
    need: number | string;
    relaxed?: boolean;
  };
}

// Guard helper functions that auto-log to diagnostics
export function requireMinLen(
  arr: any[] | null | undefined,
  min: number,
  ruleKey: string,
  fieldName: string
): boolean {
  const relaxed = isRelaxedGuardsMode();
  const has = arr?.length || 0;
  
  // In relaxed mode: reduce min by 1 (but never below 1)
  const effectiveMin = relaxed ? Math.max(1, min - 1) : min;
  const pass = has >= effectiveMin;
  
  const diag = getDiagnostics();
  if (!pass && diag.diagEnabled()) {
    diag.diagRuleEmpty(ruleKey, 'GUARD_FAIL', {
      fieldName,
      have: has,
      need: effectiveMin,
      originalNeed: min,
      relaxed
    });
  }

   if (!pass) {
     recordGuardFail(`requireMinLen(${fieldName}, ${min})`, {
       fieldName,
       have: has,
       need: effectiveMin,
       originalNeed: min,
       relaxed,
     });
   }
  
  return pass;
}

export function requireNonEmpty(
  arr: any[] | null | undefined,
  ruleKey: string,
  fieldName: string
): GuardResult {
  const relaxed = isRelaxedGuardsMode();
  const has = arr?.length || 0;
  const pass = relaxed ? true : has > 0; // In relaxed mode, allow empty but record it
  
  const diag = getDiagnostics();
  if (!pass && diag.diagEnabled()) {
    diag.diagRuleEmpty(ruleKey, 'GUARD_FAIL', {
      fieldName,
      have: has,
      need: 1,
      relaxed
    });
  }

   if (!pass) {
     recordGuardFail(`requireNonEmpty(${fieldName})`, {
       fieldName,
       have: has,
       need: 1,
       relaxed,
     });
   }
  
  return {
    pass,
    reason: pass ? undefined : {
      fieldName,
      have: has,
      need: 1,
      relaxed
    }
  };
}

// Overload for boolean return (backward compatibility)
export function requireNonEmptyBool(
  arr: any[] | null | undefined,
  ruleKey: string,
  fieldName: string
): boolean {
  return requireNonEmpty(arr, ruleKey, fieldName).pass;
}

export function requireBoth(
  arr1: any[] | null | undefined,
  arr2: any[] | null | undefined,
  ruleKey: string,
  field1: string,
  field2: string
): GuardResult {
  const relaxed = isRelaxedGuardsMode();
  const has1 = arr1?.length || 0;
  const has2 = arr2?.length || 0;
  
  // In relaxed mode: allow either present (not both required)
  const pass = relaxed ? (has1 > 0 || has2 > 0) : (has1 > 0 && has2 > 0);
  
  const diag = getDiagnostics();
  if (!pass && diag.diagEnabled()) {
    const missing = [];
    if (has1 === 0) missing.push(field1);
    if (has2 === 0) missing.push(field2);
    
    diag.diagRuleEmpty(ruleKey, 'GUARD_FAIL', {
      fieldName: `${field1} && ${field2}`,
      have: `${has1} && ${has2}`,
      need: relaxed ? 'either > 0' : 'both > 0',
      missing: missing.join(' && '),
      relaxed
    });
  }

   if (!pass) {
     recordGuardFail(`requireBoth(${field1}, ${field2})`, {
       fieldName: `${field1} && ${field2}`,
       have: `${has1} && ${has2}`,
       need: relaxed ? 'either > 0' : 'both > 0',
       relaxed,
     });
   }
  
  return {
    pass,
    reason: pass ? undefined : {
      fieldName: `${field1} && ${field2}`,
      have: `${has1} && ${has2}`,
      need: relaxed ? 'either > 0' : 'both > 0',
      relaxed
    }
  };
}

// Overload for boolean return (backward compatibility)
export function requireBothBool(
  arr1: any[] | null | undefined,
  arr2: any[] | null | undefined,
  ruleKey: string,
  field1: string,
  field2: string
): boolean {
  return requireBoth(arr1, arr2, ruleKey, field1, field2).pass;
}

// Adaptive statistical thresholds (only when RELAX_GUARDS=1)
export function getAdaptiveSigP(n: number, defaultSigP: number): number {
  const relaxed = isRelaxedGuardsMode();
  if (!relaxed) return defaultSigP;
  
  // For small samples, relax p-value threshold
  if (n < 5) {
    return 0.25; // Very lenient for tiny samples
  } else if (n < 10) {
    return 0.20; // Lenient for small samples
  } else {
    return defaultSigP; // Use default for larger samples
  }
}

export function getAdaptiveMinAbsR(n: number, defaultMinAbsR: number): number {
  const relaxed = isRelaxedGuardsMode();
  if (!relaxed) return defaultMinAbsR;
  
  // For small samples, reduce correlation threshold
  if (n < 5) {
    return Math.max(0.2, defaultMinAbsR * 0.6); // 40% reduction, min 0.2
  } else if (n < 10) {
    return Math.max(0.25, defaultMinAbsR * 0.75); // 25% reduction, min 0.25
  } else {
    return defaultMinAbsR; // Use default for larger samples
  }
}

export function shouldSkipInferentialStats(n: number): boolean {
  const relaxed = isRelaxedGuardsMode();
  if (!relaxed) return false;
  
  // For very small samples, skip p-value gating entirely
  return n < 5;
}
