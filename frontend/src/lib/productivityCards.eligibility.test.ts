import { isMetricInstrumentedForTool, generateMetricCards, determineLeader, determineLaggard, MetricCard, MetricAvailability } from './productivityCards'

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(`ASSERT FAILED: ${msg}`)
  console.log(`  ✓ ${msg}`)
}

function makeCard(overrides: Partial<MetricCard>): MetricCard {
  return {
    ide: 'test',
    value: 0,
    isLive: false,
    usesTelemetry: true,
    dataSource: 'Real',
    telemetryPointCount: 3,
    totalPointCount: 3,
    sessionCount: 0,
    hasValue: false,
    availability: 'available' as MetricAvailability,
    ...overrides,
  }
}

const noopLabel = (s: string) => s
const noopIdentity = (s: string) => s

function makeSeries(label: string, points: any[], sessionCount: number) {
  return {
    label,
    points,
    sessionCount,
    telemetryPointCount: points.length,
    usesTelemetry: true,
  }
}

console.log('\n=== Test 1: Claude Code active_coding_time_minutes — unsupported ===')
{
  const series = makeSeries('claude_code', [
    { active_coding_time_minutes: 0 },
    { active_coding_time_minutes: 0 },
  ], 66)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.active_coding_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'active_coding_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  assert(cards.length === 1, 'Card preserved for claude_code')
  const card = cards[0]
  assert(card.value === null, 'value is null for unsupported metric')
  assert(card.hasValue === false, 'hasValue is false for unsupported metric')
  assert(card.availability === 'not_instrumented', 'availability is not_instrumented')
  assert(card.sessionCount === 66, 'sessionCount preserved (66)')

  const leader = determineLeader(cards, 'active_coding_time_minutes')
  assert(leader === null, 'Claude Code excluded from leader for unsupported metric')
  const laggard = determineLaggard(cards, 'active_coding_time_minutes')
  assert(laggard === null, 'Claude Code excluded from laggard for unsupported metric')
}

console.log('\n=== Test 2: VS Code active_coding_time_minutes — genuine measured zero ===')
{
  const series = makeSeries('vscode', [
    { active_coding_time_minutes: 0 },
    { active_coding_time_minutes: 0 },
  ], 10)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.active_coding_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'active_coding_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  assert(cards.length === 1, 'Card preserved for vscode')
  const card = cards[0]
  assert(card.value === 0, 'value remains 0 (genuine measured zero)')
  assert(card.hasValue === true, 'hasValue is true for measured zero with sessions > 0')
  assert(card.availability === 'available', 'availability is available for measured zero')
}

console.log('\n=== Test 3: Claude Code average_session_length_minutes — positive value ===')
{
  const series = makeSeries('claude_code', [
    { average_session_length_minutes: 12.41 },
    { average_session_length_minutes: 10.5 },
  ], 66)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.average_session_length_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'average_session_length_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  const card = cards[0]
  assert(card.value !== null && card.value > 0, 'value is positive')
  assert(card.hasValue === true, 'hasValue is true for instrumented positive value')
  assert(card.availability === 'available', 'availability is available for positive value')
}

console.log('\n=== Test 4: Claude Code commits_per_session — measured zero ===')
{
  const series = makeSeries('claude_code', [
    { commits_per_session: 0 },
    { commits_per_session: 0 },
  ], 66)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.commits_per_session',
    comparisonMode: 'ides',
    selectedMetric: 'commits_per_session',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  const card = cards[0]
  assert(card.value === 0, 'measured zero remains 0')
  assert(card.hasValue === true, 'hasValue is true for measured zero on instrumented metric')
  assert(card.availability === 'available', 'availability is available for measured zero')
}

console.log('\n=== Test 5: Mixed — Claude Code unsupported + VS Code measured active coding ===')
{
  const ccSeries = makeSeries('claude_code', [
    { active_coding_time_minutes: 0 },
  ], 66)
  const vscodeSeries = makeSeries('vscode', [
    { active_coding_time_minutes: 15 },
  ], 30)

  const cards = generateMetricCards({
    dataSource: [ccSeries, vscodeSeries],
    activeMetricId: 'ide.active_coding_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'active_coding_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  assert(cards.length === 2, 'Both cards preserved')

  const ccCard = cards.find(c => c.rawToolId === 'claude_code')!
  const vscodeCard = cards.find(c => c.rawToolId === 'vscode')!

  assert(ccCard.value === null, 'Claude Code value is null (unsupported)')
  assert(ccCard.hasValue === false, 'Claude Code hasValue false')
  assert(ccCard.availability === 'not_instrumented', 'Claude Code availability is not_instrumented')
  assert(vscodeCard.value === 15, 'VS Code value is 15 (measured)')
  assert(vscodeCard.hasValue === true, 'VS Code hasValue true')
  assert(vscodeCard.availability === 'available', 'VS Code availability is available')

  const leader = determineLeader(cards, 'active_coding_time_minutes')
  assert(leader !== null, 'Leader exists (VS Code eligible)')
  assert(leader!.rawToolId === 'vscode', 'Leader is VS Code')

  const laggard = determineLaggard(cards, 'active_coding_time_minutes')
  assert(laggard === null, 'No laggard (only 1 eligible entity)')
}

console.log('\n=== Test 6: isMetricInstrumentedForTool direct checks ===')
{
  assert(isMetricInstrumentedForTool('claude_code', 'active_coding_time_minutes') === false, 'claude_code active_coding_time_minutes not instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'active_coding_ratio') === false, 'claude_code active_coding_ratio not instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'idle_time_minutes') === false, 'claude_code idle_time_minutes not instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'idle_ratio') === false, 'claude_code idle_ratio not instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'average_session_length_minutes') === true, 'claude_code session length instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'commits_per_session') === true, 'claude_code commits_per_session instrumented')
  assert(isMetricInstrumentedForTool('claude_code', 'ai_suggestions_accepted') === true, 'claude_code ai_suggestions_accepted instrumented')
  assert(isMetricInstrumentedForTool('vscode', 'active_coding_time_minutes') === true, 'vscode active_coding_time_minutes instrumented')
  assert(isMetricInstrumentedForTool('cursor', 'idle_time_minutes') === true, 'cursor idle_time_minutes instrumented')
}

console.log('\n=== Test 7: VS Code TTFC with sessions but no finite TTFC values — no_data ===')
{
  const series = makeSeries('vscode', [
    { time_to_first_commit_minutes: null },
    { time_to_first_commit_minutes: null },
  ], 30)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.time_to_first_commit_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'time_to_first_commit_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  assert(cards.length === 1, 'Card preserved for vscode')
  const card = cards[0]
  assert(card.value === null, 'value is null for no_data')
  assert(card.hasValue === false, 'hasValue is false for no_data')
  assert(card.availability === 'no_data', 'availability is no_data')
  assert(card.sessionCount === 30, 'sessionCount preserved (30)')

  const leader = determineLeader(cards, 'time_to_first_commit_minutes')
  assert(leader === null, 'No leader for no_data card')
  const laggard = determineLaggard(cards, 'time_to_first_commit_minutes')
  assert(laggard === null, 'No laggard for no_data card')
}

console.log('\n=== Test 8: Sparkline data — no numeric input for not_instrumented or no_data ===')
{
  // Note: sparkline construction lives in ProductivityByToolV3.vue presentation code
  // and cannot be unit-tested without extracting it. The production guard is:
  //   if (card.availability === 'available') { build sparkline } else { empty }
  // We verify here that generateMetricCards never produces a finite value
  // for not_instrumented or no_data cards, so no numeric sparkline input exists.

  const ccSeries = makeSeries('claude_code', [
    { active_coding_time_minutes: 0 },
  ], 66)
  const ccCards = generateMetricCards({
    dataSource: [ccSeries],
    activeMetricId: 'ide.active_coding_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'active_coding_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })
  assert(ccCards[0].availability === 'not_instrumented', 'CC active coding is not_instrumented')
  assert(ccCards[0].value === null, 'CC active coding value is null — no numeric sparkline input')

  const vscodeNoData = makeSeries('vscode', [
    { time_to_first_commit_minutes: null },
  ], 30)
  const ndCards = generateMetricCards({
    dataSource: [vscodeNoData],
    activeMetricId: 'ide.time_to_first_commit_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'time_to_first_commit_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })
  assert(ndCards[0].availability === 'no_data', 'VS Code TTFC is no_data')
  assert(ndCards[0].value === null, 'VS Code TTFC value is null — no numeric sparkline input')

  // Sparkline behavior for these cards requires manual screenshot verification.
  console.log('  ✓ Sparkline guard: not_instrumented and no_data cards have null values (no numeric sparkline input)')
  console.log('  ℹ Sparkline rendering requires manual screenshot verification')
}

console.log('\n=== Test 9: VS Code idle_time_minutes — missing/null/undefined fields → no_data ===')
{
  const series = makeSeries('vscode', [
    { idle_time_minutes: undefined },
    { idle_time_minutes: null },
    { some_other_field: 5 },
  ], 30)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.idle_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'idle_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  assert(cards.length === 1, 'Card preserved for vscode')
  const card = cards[0]
  assert(card.value === null, 'value is null when all points are missing/null/undefined')
  assert(card.hasValue === false, 'hasValue is false for no_data')
  assert(card.availability === 'no_data', 'availability is no_data')
}

console.log('\n=== Test 10: VS Code idle_time_minutes — two explicit numeric zeros → available ===')
{
  const series = makeSeries('vscode', [
    { idle_time_minutes: 0 },
    { idle_time_minutes: 0 },
  ], 30)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.idle_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'idle_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  const card = cards[0]
  assert(card.value === 0, 'value is 0 (genuine measured zero)')
  assert(card.hasValue === true, 'hasValue is true for measured zero')
  assert(card.availability === 'available', 'availability is available')
}

console.log('\n=== Test 11: VS Code idle_time_minutes — values 0 and 10 → average 5 ===')
{
  const series = makeSeries('vscode', [
    { idle_time_minutes: 0 },
    { idle_time_minutes: 10 },
  ], 30)

  const cards = generateMetricCards({
    dataSource: [series],
    activeMetricId: 'ide.idle_time_minutes',
    comparisonMode: 'ides',
    selectedMetric: 'idle_time_minutes',
    getCanonicalEntityLabel: noopLabel,
    getCanonicalWorkflowIdentity: noopIdentity,
  })

  const card = cards[0]
  assert(card.value === 5, 'average is 5 (zero participates in measured average)')
  assert(card.hasValue === true, 'hasValue is true')
  assert(card.availability === 'available', 'availability is available')
}

console.log('\n=== ALL TESTS PASSED ===')
