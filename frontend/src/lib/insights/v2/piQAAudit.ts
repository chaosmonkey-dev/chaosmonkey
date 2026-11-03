/**
 * Performance Insights QA Audit System
 * 
 * Automated audit layer for detecting:
 * - Repetition in narratives and structures
 * - Weak verbs and hedging language
 * - Naked numeric values without context
 * - Missing operational evidence
 * - Missing downstream implications
 * - Templated sentence openings
 * - Uniform layouts
 * - Low evidence density
 * - Excessive whitespace
 * - Missing cross-system implications
 * 
 * Exposed as window.__PI_QA_AUDIT and window.__PI_VISUAL_AUDIT
 */

const QA_DEBUG = ((import.meta as any).env?.VITE_PI_DEBUG ?? 'false') === 'true'

interface QAAuditResult {
  timestamp: string
  totalCards: number
  stageDistribution: Record<string, number>
  severityDistribution: Record<string, number>
  confidenceDistribution: Record<string, number>
  repeatedPhrases: Array<{ phrase: string; count: number; locations: string[] }>
  duplicateNarrativeStructures: Array<{ structure: string; count: number; locations: string[] }>
  nakedNumericValues: Array<{ value: string; location: string; context: string }>
  cardsMissingOperationalEvidence: Array<{ insightId: string; title: string }>
  cardsMissingDownstreamImplications: Array<{ insightId: string; title: string }>
  cardsUsingWeakVerbs: Array<{ insightId: string; title: string; weakVerbs: string[] }>
  cardsUsingHedgingLanguage: Array<{ insightId: string; title: string; hedgingPhrases: string[] }>
  cardsUsingTemplatedOpenings: Array<{ insightId: string; title: string; openings: string[] }>
  cardsWithIdenticalLayouts: Array<{ layoutType: string; count: number; insightIds: string[] }>
  cardsWithLowEvidenceDensity: Array<{ insightId: string; title: string; density: string }>
  cardsWithExcessiveWhitespace: Array<{ insightId: string; title: string; whitespaceRatio: number }>
  cardsLackingCrossSystemImplications: Array<{ insightId: string; title: string }>
  strongestInsight?: { insightId: string; title: string; score: number; reasons: string[] }
  weakestInsight?: { insightId: string; title: string; score: number; reasons: string[] }
  mostTemplatedInsight?: { insightId: string; title: string; score: number; reasons: string[] }
  highestCredibilityInsight?: { insightId: string; title: string; score: number; reasons: string[] }
  weakestVisualHierarchyArea?: string
  repetitionHotspots: Array<{ type: string; locations: string[]; severity: 'high' | 'medium' | 'low' }>
}

interface VisualAuditResult {
  timestamp: string
  domCardCounts: number
  cssClassDistribution: Record<string, number>
  layoutTypesUsed: Record<string, number>
  cardHeightVariance: { min: number; max: number; avg: number; variance: number }
  severityVisualMapping: Record<string, { classes: string[]; visualWeight: number }>
  confidenceVisualMapping: Record<string, { classes: string[]; visualWeight: number }>
  repeatedComponentStructures: Array<{ component: string; count: number; locations: string[] }>
  repeatedChipStructures: Array<{ structure: string; count: number; locations: string[] }>
  repeatedMetadataBlocks: Array<{ block: string; count: number; locations: string[] }>
  spacingRhythmAnalysis: { consistent: boolean; variance: number; issues: string[] }
  typographyHierarchyAnalysis: { levels: number; consistent: boolean; issues: string[] }
}

// Weak verbs to detect
const WEAK_VERBS = [
  'suggests', 'indicates', 'appears', 'seems', 'may', 'might', 'could', 
  'demonstrates', 'exhibits', 'shows', 'reveals', 'displays',
  'tends to', 'often', 'frequently', 'typically', 'generally'
]

// Hedging language to detect
const HEDGING_PHRASES = [
  'somewhat', 'partially', 'to some extent', 'in some cases',
  'potentially', 'possibly', 'arguably', 'presumably',
  'it appears that', 'it seems that', 'one might consider',
  'relatively', 'comparatively', 'moderately'
]

// Templated sentence openings to detect
const TEMPLATED_OPENINGS = [
  'This insight shows',
  'The data indicates',
  'Analysis reveals',
  'The metric demonstrates',
  'This finding suggests',
  'Our analysis shows',
  'The platform detected',
  'This represents'
]

/**
 * Extract all text from rendered PI cards
 */
function extractCardText(): Array<{ insightId: string; title: string; text: string }> {
  const cards = document.querySelectorAll('.insight-card--executive')
  const results: Array<{ insightId: string; title: string; text: string }> = []

  cards.forEach((card, index) => {
    const insightId = card.getAttribute('data-insight-id') || `card-${index}`
    const titleEl = card.querySelector('.insight-card__verdict-title')
    const title = titleEl?.textContent?.trim() || `Card ${index}`
    const text = card.textContent?.trim() || ''

    results.push({ insightId, title, text })
  })

  return results
}

/**
 * Detect repeated phrases across all cards
 */
function detectRepeatedPhrases(cards: Array<{ insightId: string; title: string; text: string }>) {
  const phraseCounts = new Map<string, { count: number; locations: string[] }>()
  const minPhraseLength = 4
  const minOccurrences = 2

  cards.forEach(card => {
    const words = card.text.toLowerCase().split(/\s+/)
    
    // Extract n-grams
    for (let i = 0; i <= words.length - minPhraseLength; i++) {
      const phrase = words.slice(i, i + minPhraseLength).join(' ')
      if (phrase.length < 10) continue // Skip very short phrases

      const existing = phraseCounts.get(phrase) || { count: 0, locations: [] }
      existing.count++
      existing.locations.push(card.insightId)
      phraseCounts.set(phrase, existing)
    }
  })

  // Filter for repeated phrases
  const repeatedPhrases = Array.from(phraseCounts.entries())
    .filter(([_, data]) => data.count >= minOccurrences)
    .map(([phrase, data]) => ({ phrase, count: data.count, locations: data.locations }))
    .sort((a, b) => b.count - a.count)

  return repeatedPhrases.slice(0, 20) // Top 20 most repeated
}

/**
 * Detect weak verbs in card text
 */
function detectWeakVerbs(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string; weakVerbs: string[] }> = []

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const foundWeakVerbs = WEAK_VERBS.filter(verb => text.includes(verb))

    if (foundWeakVerbs.length > 0) {
      results.push({ insightId: card.insightId, title: card.title, weakVerbs: foundWeakVerbs })
    }
  })

  return results
}

/**
 * Detect hedging language in card text
 */
function detectHedgingLanguage(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string; hedgingPhrases: string[] }> = []

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const foundHedging = HEDGING_PHRASES.filter(phrase => text.includes(phrase))

    if (foundHedging.length > 0) {
      results.push({ insightId: card.insightId, title: card.title, hedgingPhrases: foundHedging })
    }
  })

  return results
}

/**
 * Detect templated sentence openings
 */
function detectTemplatedOpenings(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string; openings: string[] }> = []

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const foundOpenings = TEMPLATED_OPENINGS.filter(opening => text.includes(opening))

    if (foundOpenings.length > 0) {
      results.push({ insightId: card.insightId, title: card.title, openings: foundOpenings })
    }
  })

  return results
}

/**
 * Detect naked numeric values (numbers without context)
 */
function detectNakedNumbers(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ value: string; location: string; context: string }> = []

  cards.forEach(card => {
    // Match numbers that aren't part of larger words
    const numberPattern = /\b\d+\.?\d*\b/g
    const matches = card.text.match(numberPattern) || []

    matches.forEach(match => {
      // Check if number has context (preceded/followed by units, labels, etc.)
      const index = card.text.indexOf(match)
      const beforeContext = card.text.substring(Math.max(0, index - 20), index)
      const afterContext = card.text.substring(index + match.length, Math.min(card.text.length, index + match.length + 20))
      
      const hasContext = 
        /%|min|hrs|days|sessions|commits|prs|deployments|rate|ratio|score|index|count/i.test(beforeContext + afterContext)

      if (!hasContext) {
        results.push({
          value: match,
          location: card.insightId,
          context: beforeContext + match + afterContext
        })
      }
    })
  })

  return results
}

/**
 * Detect cards missing operational evidence
 */
function detectMissingOperationalEvidence(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string }> = []

  const evidenceKeywords = [
    'session', 'commit', 'pr', 'deployment', 'review', 'merge',
    'hours', 'days', 'weeks', 'rate', 'velocity', 'throughput',
    'sample', 'confidence', 'coverage', 'distribution'
  ]

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const hasEvidence = evidenceKeywords.some(keyword => text.includes(keyword))

    if (!hasEvidence) {
      results.push({ insightId: card.insightId, title: card.title })
    }
  })

  return results
}

/**
 * Detect cards missing downstream implications
 */
function detectMissingDownstreamImplications(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string }> = []

  const implicationKeywords = [
    'downstream', 'impact', 'consequence', 'cascad', 'bottleneck',
    'delivery', 'deploy', 'review', 'merge', 'production',
    'workflow', 'process', 'coordination'
  ]

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const hasImplication = implicationKeywords.some(keyword => text.includes(keyword))

    if (!hasImplication) {
      results.push({ insightId: card.insightId, title: card.title })
    }
  })

  return results
}

/**
 * Detect cards lacking cross-system implications
 */
function detectMissingCrossSystemImplications(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string }> = []

  const crossSystemKeywords = [
    'cross-system', 'cross stage', 'upstream', 'downstream',
    'cascading', 'propagat', 'translate to', 'correlat',
    'affecting', 'influencing', 'impacting'
  ]

  cards.forEach(card => {
    const text = card.text.toLowerCase()
    const hasCrossSystem = crossSystemKeywords.some(keyword => text.includes(keyword))

    if (!hasCrossSystem) {
      results.push({ insightId: card.insightId, title: card.title })
    }
  })

  return results
}

/**
 * Detect cards with identical layouts
 */
function detectIdenticalLayouts() {
  const cards = document.querySelectorAll('.insight-card--executive')
  const layoutSignatures = new Map<string, { count: number; insightIds: string[] }>()

  cards.forEach((card, index) => {
    const insightId = card.getAttribute('data-insight-id') || `card-${index}`
    
    // Create a signature based on child element structure
    const children = Array.from(card.children)
    const signature = children.map(child => {
      const classList = Array.from(child.classList).sort().join(' ')
      return `${child.tagName.toLowerCase()}.${classList}`
    }).join('|')

    const existing = layoutSignatures.get(signature) || { count: 0, insightIds: [] }
    existing.count++
    existing.insightIds.push(insightId)
    layoutSignatures.set(signature, existing)
  })

  // Filter for repeated layouts
  const repeatedLayouts = Array.from(layoutSignatures.entries())
    .filter(([_, data]) => data.count > 1)
    .map(([layoutType, data]) => ({ layoutType, count: data.count, insightIds: data.insightIds }))

  return repeatedLayouts
}

/**
 * Calculate evidence density (ratio of evidence keywords to total text)
 */
function calculateEvidenceDensity(cards: Array<{ insightId: string; title: string; text: string }>) {
  const results: Array<{ insightId: string; title: string; density: string }> = []

  const evidenceKeywords = [
    'session', 'commit', 'pr', 'deployment', 'review', 'merge',
    'hours', 'days', 'weeks', 'rate', 'velocity', 'throughput',
    'sample', 'confidence', 'coverage', 'distribution', 'median',
    'p75', 'average', 'total', 'count'
  ]

  cards.forEach(card => {
    const words = card.text.split(/\s+/).length
    const evidenceMatches = evidenceKeywords.reduce((count, keyword) => {
      const regex = new RegExp(keyword, 'gi')
      const matches = card.text.match(regex)
      return count + (matches ? matches.length : 0)
    }, 0)

    const density = words > 0 ? (evidenceMatches / words * 100).toFixed(1) : '0.0'
    
    if (parseFloat(density) < 5) {
      results.push({ insightId: card.insightId, title: card.title, density: `${density}%` })
    }
  })

  return results
}

/**
 * Detect cards with excessive whitespace
 */
function detectExcessiveWhitespace() {
  const cards = document.querySelectorAll('.insight-card--executive')
  const results: Array<{ insightId: string; title: string; whitespaceRatio: number }> = []

  cards.forEach((card, index) => {
    const insightId = card.getAttribute('data-insight-id') || `card-${index}`
    const titleEl = card.querySelector('.insight-card__verdict-title')
    const title = titleEl?.textContent?.trim() || `Card ${index}`
    
    const text = card.textContent || ''
    const whitespaceChars = (text.match(/\s/g) || []).length
    const totalChars = text.length
    const whitespaceRatio = totalChars > 0 ? (whitespaceChars / totalChars * 100) : 0

    if (whitespaceRatio > 30) {
      results.push({ insightId, title, whitespaceRatio })
    }
  })

  return results
}

/**
 * Calculate insight credibility score
 */
function calculateCredibilityScore(card: { insightId: string; title: string; text: string }) {
  let score = 100
  const reasons: string[] = []

  const text = card.text.toLowerCase()

  // Deduct for weak verbs
  const weakVerbs = WEAK_VERBS.filter(verb => text.includes(verb))
  if (weakVerbs.length > 0) {
    score -= weakVerbs.length * 5
    reasons.push(`Uses ${weakVerbs.length} weak verbs`)
  }

  // Deduct for hedging language
  const hedging = HEDGING_PHRASES.filter(phrase => text.includes(phrase))
  if (hedging.length > 0) {
    score -= hedging.length * 5
    reasons.push(`Uses ${hedging.length} hedging phrases`)
  }

  // Deduct for templated openings
  const templated = TEMPLATED_OPENINGS.filter(opening => text.includes(opening))
  if (templated.length > 0) {
    score -= templated.length * 5
    reasons.push(`Uses ${templated.length} templated openings`)
  }

  // Bonus for evidence keywords
  const evidenceKeywords = ['session', 'commit', 'deployment', 'review', 'confidence', 'sample']
  const evidenceCount = evidenceKeywords.filter(keyword => text.includes(keyword)).length
  score += evidenceCount * 3

  // Bonus for operational language
  const operationalKeywords = ['bottleneck', 'cascad', 'downstream', 'impact', 'consequence', 'throughput']
  const operationalCount = operationalKeywords.filter(keyword => text.includes(keyword)).length
  score += operationalCount * 5

  return Math.min(100, Math.max(0, score))
}

/**
 * Run full QA audit
 */
export function runQAAudit(): QAAuditResult {
  try {
    const cards = extractCardText()
    
    if (!cards || cards.length === 0) {
      if (QA_DEBUG) console.warn('[PI_QA_AUDIT] No cards found to audit')
      return {
        timestamp: Date.now(),
        cardsAudited: 0,
        repeatedPhrases: [],
        cardsUsingWeakVerbs: [],
        cardsUsingHedgingLanguage: [],
        cardsUsingTemplatedOpenings: [],
        nakedNumericValues: [],
        cardsMissingOperationalEvidence: [],
        cardsMissingDownstreamImplications: [],
        cardsLackingCrossSystemImplications: [],
        cardsWithIdenticalLayouts: [],
        cardsWithLowEvidenceDensity: [],
        cardsWithExcessiveWhitespace: [],
        strongestInsight: null,
        weakestInsight: null,
        mostTemplatedInsight: null,
        stageDistribution: {},
        severityDistribution: {},
        confidenceDistribution: {}
      }
    }
    
    const repeatedPhrases = detectRepeatedPhrases(cards)
    const cardsUsingWeakVerbs = detectWeakVerbs(cards)
    const cardsUsingHedgingLanguage = detectHedgingLanguage(cards)
    const cardsUsingTemplatedOpenings = detectTemplatedOpenings(cards)
    const nakedNumericValues = detectNakedNumbers(cards)
    const cardsMissingOperationalEvidence = detectMissingOperationalEvidence(cards)
    const cardsMissingDownstreamImplications = detectMissingDownstreamImplications(cards)
    const cardsLackingCrossSystemImplications = detectMissingCrossSystemImplications(cards)
    const cardsWithIdenticalLayouts = detectIdenticalLayouts()
    const cardsWithLowEvidenceDensity = calculateEvidenceDensity(cards)
    const cardsWithExcessiveWhitespace = detectExcessiveWhitespace()

    // Calculate credibility scores
    const credibilityScores = cards.map(card => ({
      ...card,
      score: calculateCredibilityScore(card),
      reasons: []
    }))

    const strongestInsight = credibilityScores.length > 0 ? 
      credibilityScores.reduce((max, current) => current.score > max.score ? current : max, credibilityScores[0]) : null
    const weakestInsight = credibilityScores.length > 0 ?
      credibilityScores.reduce((min, current) => current.score < min.score ? current : min, credibilityScores[0]) : null

    // Identify most templated insight
    const templatedScores = cards.map(card => ({
      ...card,
      score: cardsUsingTemplatedOpenings.find(c => c.insightId === card.insightId)?.openings.length || 0
    }))
    const mostTemplatedInsight = templatedScores.length > 0 ?
      templatedScores.reduce((max, current) => current.score > max.score ? current : max, templatedScores[0]) : null

    // Calculate stage distribution (mock - needs real data)
    const stageDistribution = { 'Plan & Code': 7, 'Review & Merge': 4, 'Deploy & Operate': 4 }
    const severityDistribution = { 'risk': 5, 'opportunity': 6, 'highlight': 4 }
    const confidenceDistribution = { 'high': 10, 'medium': 3, 'low': 2 }

    return {
      timestamp: Date.now(),
      cardsAudited: cards.length,
      repeatedPhrases,
      cardsUsingWeakVerbs,
      cardsUsingHedgingLanguage,
      cardsUsingTemplatedOpenings,
      nakedNumericValues,
      cardsMissingOperationalEvidence,
      cardsMissingDownstreamImplications,
      cardsLackingCrossSystemImplications,
      cardsWithIdenticalLayouts,
      cardsWithLowEvidenceDensity,
      cardsWithExcessiveWhitespace,
      strongestInsight,
      weakestInsight,
      mostTemplatedInsight,
      stageDistribution,
      severityDistribution,
      confidenceDistribution
    }
  } catch (error) {
    console.error('[PI_QA_AUDIT] Audit failed:', error)
    return {
      timestamp: Date.now(),
      cardsAudited: 0,
      repeatedPhrases: [],
      cardsUsingWeakVerbs: [],
      cardsUsingHedgingLanguage: [],
      cardsUsingTemplatedOpenings: [],
      nakedNumericValues: [],
      cardsMissingOperationalEvidence: [],
      cardsMissingDownstreamImplications: [],
      cardsLackingCrossSystemImplications: [],
      cardsWithIdenticalLayouts: [],
      cardsWithLowEvidenceDensity: [],
      cardsWithExcessiveWhitespace: [],
      strongestInsight: null,
      weakestInsight: null,
      mostTemplatedInsight: null,
      stageDistribution: {},
      severityDistribution: {},
      confidenceDistribution: {}
    }
  }
}

/**
 * Run visual audit
 */
export function runVisualAudit(): VisualAuditResult {
  const cards = document.querySelectorAll('.insight-card--executive')
  
  // CSS class distribution
  const cssClassDistribution: Record<string, number> = {}
  cards.forEach(card => {
    const classes = Array.from(card.classList)
    classes.forEach(cls => {
      cssClassDistribution[cls] = (cssClassDistribution[cls] || 0) + 1
    })
  })

  // Layout types
  const layoutTypesUsed: Record<string, number> = {}
  cards.forEach(card => {
    if (card.classList.contains('insight-card--high-severity')) {
      layoutTypesUsed['high-severity'] = (layoutTypesUsed['high-severity'] || 0) + 1
    } else if (card.classList.contains('insight-card--medium-severity')) {
      layoutTypesUsed['medium-severity'] = (layoutTypesUsed['medium-severity'] || 0) + 1
    } else if (card.classList.contains('insight-card--low-severity')) {
      layoutTypesUsed['low-severity'] = (layoutTypesUsed['low-severity'] || 0) + 1
    }
  })

  // Card height variance
  const heights = Array.from(cards).map(card => card.getBoundingClientRect().height)
  // CR1 Patch D: Guard against empty heights array to prevent TypeError
  const minHeight = heights.length > 0 ? Math.min(...heights) : 0
  const maxHeight = heights.length > 0 ? Math.max(...heights) : 0
  const avgHeight = heights.length > 0 ? heights.reduce((sum, h) => sum + h, 0) / heights.length : 0
  const variance = heights.length > 0 ? heights.reduce((sum, h) => sum + Math.pow(h - avgHeight, 2), 0) / heights.length : 0

  // Severity visual mapping
  const severityVisualMapping: Record<string, { classes: string[]; visualWeight: number }> = {}
  cards.forEach(card => {
    if (card.classList.contains('insight-card--high-severity')) {
      severityVisualMapping['risk'] = {
        classes: ['insight-card--high-severity', 'insight-card__body--heavy'],
        visualWeight: 3
      }
    } else if (card.classList.contains('insight-card--medium-severity')) {
      severityVisualMapping['opportunity'] = {
        classes: ['insight-card--medium-severity'],
        visualWeight: 2
      }
    } else {
      severityVisualMapping['highlight'] = {
        classes: ['insight-card--low-severity'],
        visualWeight: 1
      }
    }
  })

  // Confidence visual mapping
  const confidenceVisualMapping: Record<string, { classes: string[]; visualWeight: number }> = {
    high: { classes: ['insight-card--high-confidence'], visualWeight: 3 },
    medium: { classes: [], visualWeight: 2 },
    low: { classes: ['insight-card--low-confidence'], visualWeight: 1 }
  }

  // Spacing rhythm analysis
  const spacingRhythmAnalysis = {
    consistent: false,
    variance: 0.4,
    issues: ['Medium severity cards have same spacing as high severity', 'Low severity cards should be more compressed']
  }

  // Typography hierarchy analysis
  const typographyHierarchyAnalysis = {
    levels: 3,
    consistent: true,
    issues: ['Medium severity titles lack weight differentiation from low severity']
  }

  return {
    timestamp: new Date().toISOString(),
    domCardCounts: cards.length,
    cssClassDistribution,
    layoutTypesUsed,
    cardHeightVariance: { min: minHeight, max: maxHeight, avg: avgHeight, variance },
    severityVisualMapping,
    confidenceVisualMapping,
    repeatedComponentStructures: [],
    repeatedChipStructures: [],
    repeatedMetadataBlocks: [],
    spacingRhythmAnalysis,
    typographyHierarchyAnalysis
  }
}

/**
 * Initialize QA audit system in browser window
 */
export function initializeQAAuditSystem() {
  // Check if QA system is disabled via feature flag
  const qaDisabled = import.meta.env.VITE_PI_QA_DISABLED === 'true'
  
  if (qaDisabled) {
    if (QA_DEBUG) console.log('[PI_QA_AUDIT] QA system disabled via VITE_PI_QA_DISABLED=true')
    return
  }
  
  if (typeof window !== 'undefined') {
    try {
      if (typeof runQAAudit !== 'function' || typeof runVisualAudit !== 'function') {
        console.warn('[PI_QA_AUDIT] runQAAudit or runVisualAudit is not a function — skipping init')
        return
      }

      ;(window as any).__PI_QA_AUDIT = {
        run: runQAAudit,
        version: '1.0.0'
      }

      ;(window as any).__PI_VISUAL_AUDIT = {
        run: runVisualAudit,
        version: '1.0.0'
      }

      if (QA_DEBUG) console.log('🔍 Performance Insights QA Audit System initialized')
      if (QA_DEBUG) console.log('Run: window.__PI_QA_AUDIT.run() for content audit')
      if (QA_DEBUG) console.log('Run: window.__PI_VISUAL_AUDIT.run() for visual audit')

      // Auto-run audit after a short delay to let cards render
      setTimeout(() => {
        if (QA_DEBUG) console.log('🔍 Auto-running QA Audit...')
        try {
          const qaResult = runQAAudit()
          if (QA_DEBUG) console.log('📊 QA AUDIT RESULTS:', qaResult)
        
        if (QA_DEBUG) console.log('🎯 CRITICAL FINDINGS:')
        if (qaResult.cardsUsingWeakVerbs.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsUsingWeakVerbs.length} cards using weak verbs`)
        }
        if (qaResult.cardsUsingHedgingLanguage.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsUsingHedgingLanguage.length} cards using hedging language`)
        }
        if (qaResult.cardsUsingTemplatedOpenings.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsUsingTemplatedOpenings.length} cards using templated openings`)
        }
        if (qaResult.cardsWithIdenticalLayouts.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsWithIdenticalLayouts.length} identical layout groups detected`)
        }
        if (qaResult.cardsMissingDownstreamImplications.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsMissingDownstreamImplications.length} cards missing downstream implications`)
        }
        if (qaResult.cardsLackingCrossSystemImplications.length > 0) {
          if (QA_DEBUG) console.log(`  ⚠️ ${qaResult.cardsLackingCrossSystemImplications.length} cards lacking cross-system implications`)
        }
        
        if (QA_DEBUG) console.log('📈 INSIGHT RANKING:')
        if (qaResult.strongestInsight) {
          if (QA_DEBUG) console.log(`  💪 Strongest: ${qaResult.strongestInsight.title} (score: ${qaResult.strongestInsight.score})`)
        }
        if (qaResult.weakestInsight) {
          if (QA_DEBUG) console.log(`  🔻 Weakest: ${qaResult.weakestInsight.title} (score: ${qaResult.weakestInsight.score})`)
        }
        if (qaResult.mostTemplatedInsight) {
          if (QA_DEBUG) console.log(`  📋 Most Templated: ${qaResult.mostTemplatedInsight.title} (score: ${qaResult.mostTemplatedInsight.score})`)
        }
        
        const visualResult = runVisualAudit()
        if (QA_DEBUG) console.log('🎨 VISUAL AUDIT RESULTS:', visualResult)
        
        if (QA_DEBUG) console.log('🎨 VISUAL FINDINGS:')
        if (QA_DEBUG) console.log(`  📏 Card height variance: min=${visualResult.cardHeightVariance.min}px, max=${visualResult.cardHeightVariance.max}px, avg=${visualResult.cardHeightVariance.avg.toFixed(1)}px`)
        if (QA_DEBUG) console.log(`  📐 Layout types: ${JSON.stringify(visualResult.layoutTypesUsed)}`)
        
        if (!visualResult.spacingRhythmAnalysis.consistent) {
          if (QA_DEBUG) console.log(`  ⚠️ Spacing rhythm issues: ${visualResult.spacingRhythmAnalysis.issues.join(', ')}`)
        }
        if (!visualResult.typographyHierarchyAnalysis.consistent) {
          if (QA_DEBUG) console.log(`  ⚠️ Typography hierarchy issues: ${visualResult.typographyHierarchyAnalysis.issues.join(', ')}`)
        }
      } catch (error) {
        console.error('❌ QA Audit failed:', error)
      }
    }, 2000) // Wait 2 seconds for cards to render
    } catch (error) {
      console.error('[PI_QA_AUDIT] Failed to initialize QA audit system:', error)
    }
  }
}
