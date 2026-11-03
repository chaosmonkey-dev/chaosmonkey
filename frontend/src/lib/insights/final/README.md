# Final Canonical Performance Insights Architecture

**Purpose:** Single source of truth for canonical Performance Insights, replacing the fragmented V2 system.

**Status:** Phase A - Schema frozen, contract defined. Generators not yet implemented.

---

## Overview

This directory contains the new canonical PI architecture. It is designed to replace the current fragmented V2 system with a clean, maintainable, and understandable architecture.

### What This Replaces

**Old Fragmented Systems (to be deprecated):**
- `v2/CANONICAL_PI_REGISTRY.ts` - Old canonical registry (14 IDs but mixed with old logic)
- `v2/piV2Manifest.ts` - MVP allowlist (28 IDs, conflicts with canonical)
- `v2/V2_PREVIEW_ROW_IDS.ts` - Old canonical set (35+ IDs, deprecated IDs mixed in)
- `v2/piRegistry.ts` - Another old registry (conflicting source of truth)
- `v2/computeV2PerformanceInsights.ts` - 13,680 LOC monolith (to be replaced)
- `v2/shadow.ts` - Shadow fallback logic (V1/V2 dual path, to be removed)

**New Single Source of Truth:**
- `final/canonicalInsights.ts` - The ONLY canonical registry (14 IDs)
- `final/types.ts` - The ONLY output contract for UI

---

## Canonical PI Inventory

### Total: 14 Canonical PIs

**Plan & Code (5 insights):**
1. `active-coding-time-by-ide` - Active coding time by IDE
2. `delivery-rate-ai-vs-non-ai` - Delivery rate: AI vs Non-AI
3. `telemetry-ai-focus-imbalance` - AI focus imbalance detected
4. `session-conditioned-pr-cycle-time-ai-vs-non-ai` - PR cycle time: AI vs Non-AI
5. `executive-ai-yield-optimization` - AI yield optimization (Executive Finding)

**Review & Merge (5 insights):**
1. `reopen-pressure-spike` - PR reopen pressure spike
2. `reviewer-load-concentration` - Reviewer load concentration
3. `revert-rate-by-ide` - Revert rate by IDE
4. `executive-ai-reopen-pressure-risk` - AI reopen pressure risk (Executive Finding)
5. `executive-small-pr-workflow-optimization` - Small PR workflow optimization (Executive Finding)

**Deploy & Operate (4 insights):**
1. `delivery-velocity-by-workflow` - Delivery velocity by workflow
2. `change-failure-rate-spike-by-ide` - Change failure rate spike by IDE
3. `synthesized-deployment-cadence` - Synthesized deployment cadence
4. `executive-stable-deployment-acceleration` - Stable deployment acceleration (Executive Finding)

---

## Architecture Principles

### 1. Single Source of Truth
- `canonicalInsights.ts` is the ONLY registry
- No other allowlists, manifests, or registries
- Generators read from registry, not hardcoded IDs

### 2. Deterministic Generation
- Each canonical PI has exactly one generator function
- Generators return canonical insight or null (no fallbacks)
- No silent fallbacks to placeholder data

### 3. No Hidden Filtering
- Only one filter: canonical registry filter
- No MVP allowlist, no manifest filtering
- No confidence/baseline/no-delta gates for canonical PIs
- All 14 canonical PIs always render if generated

### 4. Stage Isolation
- Generators organized by stage (planCode, reviewMerge, deployOperate)
- Executive findings in separate file (executiveMigrated.ts)
- Clear separation of concerns

### 5. Clear Data Flow
- `dataAccess.ts` - Fetches data from APIs
- `generators/` - Compute insights from data
- `synthesizeInsight.ts` - Adds evidence/recommendations
- `rankInsights.ts` - Orders by renderOrder
- `renderAdapter.ts` - Adapts for UI

---

## File Structure (Planned)

```
final/
├── types.ts                      # Shared types (DONE)
├── canonicalInsights.ts          # 14 canonical PI definitions (DONE)
├── README.md                     # This file (DONE)
├── dataAccess.ts                 # API data fetching (TODO)
├── generators/
│   ├── planCode.ts              # Plan & Code generators (TODO)
│   ├── reviewMerge.ts           # Review & Merge generators (TODO)
│   ├── deployOperate.ts         # Deploy & Operate generators (TODO)
│   └── executiveMigrated.ts     # Executive findings generators (TODO)
├── synthesizeInsight.ts         # Insight synthesis (TODO)
├── rankInsights.ts              # Ranking and ordering (TODO)
├── renderAdapter.ts             # UI adaptation (TODO)
└── index.ts                     # Public API (TODO)
```

---

## Current Status

### Phase A: Schema Frozen (COMPLETED)
- ✅ `types.ts` - Canonical output contract defined
- ✅ `canonicalInsights.ts` - 14 canonical PIs defined
- ✅ `README.md` - Architecture documentation
- ✅ `assertFinalCanonicalInventory()` - Validation function

### Phase B: Create Generators (NOT STARTED)
- ⏳ `dataAccess.ts` - API data fetching
- ⏳ `generators/planCode.ts` - 5 generators
- ⏳ `generators/reviewMerge.ts` - 5 generators
- ⏳ `generators/deployOperate.ts` - 4 generators
- ⏳ `generators/executiveMigrated.ts` - 4 executive generators

### Phase C: Orchestration (NOT STARTED)
- ⏳ `synthesizeInsight.ts` - Evidence/recommendations
- ⏳ `rankInsights.ts` - Sorting
- ⏳ `renderAdapter.ts` - UI adaptation
- ⏳ `index.ts` - Public API

### Phase D: Integration (NOT STARTED)
- ⏳ Route PerformanceInsightsWidget to new engine behind flag
- ⏳ Keep old engine running for comparison
- ⏳ Verify all 14 PIs render

---

## Validation

Run the validation function to verify the canonical inventory:

```typescript
import { assertFinalCanonicalInventory } from './canonicalInsights';

// This will throw if validation fails
assertFinalCanonicalInventory();
```

Expected output:
```
[CANONICAL_INVENTORY_VALIDATION_PASSED] {
  total: 14,
  planCode: 5,
  reviewMerge: 5,
  deployOperate: 4,
  executiveFindings: 4
}
```

---

## Migration Strategy

### Phase A: Freeze Schema (Current)
- Define canonical registry
- Define output contract
- Add validation
- **No routing changes yet**
- **No UI changes yet**

### Phase B: Create Generators
- Extract generators from computeV2PerformanceInsights.ts
- Organize by stage
- Implement all 14 generators
- Test with real data

### Phase C: Orchestration
- Create synthesis logic
- Create ranking logic
- Create render adapter
- Create public API

### Phase D: Integration
- Add feature flag: `VITE_USE_FINAL_PI_ENGINE`
- Route widget to new engine behind flag
- Keep old engine running for comparison
- Verify all 14 PIs render

### Phase E: Cleanup
- Remove old computeV2PerformanceInsights.ts
- Remove piV2Manifest.ts
- Remove V2_PREVIEW_ROW_IDS.ts
- Remove shadow fallback logic
- Remove old registries

---

## Key Differences from Old System

### Old System Problems
- Multiple conflicting sources of truth (4 registries)
- 13,680 LOC monolith
- Hidden filtering at 7 stages
- Silent fallbacks to V1 engine
- MVP allowlist (28 IDs) conflicts with canonical (14 IDs)
- Executive findings in separate system

### New System Benefits
- Single source of truth (1 registry)
- Organized by stage (max ~500 LOC per file)
- No hidden filtering (only canonical filter)
- No silent fallbacks
- Canonical IDs only (14 PIs)
- Executive findings integrated into canonical

---

## Development Guidelines

### Adding a New Canonical PI
1. Add entry to `canonicalInsights.ts` CANONICAL_PI_REGISTRY
2. Add generator function to appropriate stage file
3. Run `assertFinalCanonicalInventory()` to validate
4. Test with real data
5. Verify it renders in UI

### Modifying an Existing PI
1. Update entry in `canonicalInsights.ts`
2. Update generator function
3. Run validation
4. Test with real data
5. Verify UI updates

### Removing a Canonical PI
1. Remove entry from `canonicalInsights.ts`
2. Remove generator function
3. Run validation (should fail if count != 14)
4. Update validation if 14 is no longer required
5. Verify UI updates

---

## Acceptance Criteria

The final architecture is acceptable only if:

1. **Exactly 14 canonical PIs render**
2. **No fallback can replace them silently**
3. **No gate can silently remove Tier 1/demo PIs**
4. **All 3 stages have strong PIs**
5. **Migrated Executive Findings preserve rich evidence/recommendation structure**
6. **Old Executive Findings section remains visible until migration is verified**
7. **Build passes**
8. **No console crash**
9. **Future dev can understand PI engine without reading 13k LOC**

---

**Last Updated:** May 19, 2026
**Phase:** A - Schema Frozen
**Next:** Phase B - Create Generators
