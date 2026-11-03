/**
 * Operational Pill Generation System
 * 
 * Generates short, operationally authentic pills that sound like
 * they came from real engineering analytics platforms, not AI.
 * 
 * CREDIBILITY PRINCIPLES:
 * - Short, direct operational labels
 * - No abstract compound nouns
 * - Sound like real analytics platform tags
 * - Avoid taxonomy-generated language
 */

export type PillCategory = 
  | 'workflow_issue'
  | 'quality_concern' 
  | 'efficiency_gain'
  | 'resource_pressure'
  | 'coordination_problem'
  | 'stability_risk'
  | 'velocity_impact'
  | 'capacity_constraint';

/**
 * Direct operational pill labels
 * These sound like real engineering platform tags, not AI-generated taxonomy
 */
const OPERATIONAL_PILLS: Record<PillCategory, string[]> = {
  workflow_issue: [
    'Reviewer saturation',
    'Merge conflicts',
    'Handoff delays',
    'Queue bottlenecks',
    'Approval lag',
    'Coordination overhead'
  ],
  
  quality_concern: [
    'Reopen pressure',
    'Rework rate',
    'Quality drift',
    'Validation gaps',
    'Review compression',
    'Stability decline'
  ],
  
  efficiency_gain: [
    'Cycle time reduction',
    'Throughput gain',
    'Delivery acceleration',
    'Process optimization',
    'Automation benefit',
    'Velocity improvement'
  ],
  
  resource_pressure: [
    'Reviewer load',
    'Pipeline strain',
    'Capacity limits',
    'Resource saturation',
    'Infrastructure stress',
    'Team bandwidth'
  ],
  
  coordination_problem: [
    'Team fragmentation',
    'Workflow variance',
    'Communication lag',
    'Process divergence',
    'Tool inconsistency',
    'Role confusion'
  ],
  
  stability_risk: [
    'Deployment risk',
    'Failure rate',
    'Rollback pressure',
    'Incident elevation',
    'Reliability decline',
    'System stress'
  ],
  
  velocity_impact: [
    'Delivery slowdown',
    'Merge velocity',
    'Release cadence',
    'Throughput variance',
    'Cycle time impact',
    'Time-to-market'
  ],
  
  capacity_constraint: [
    'Reviewer shortage',
    'Pipeline bottleneck',
    'Testing limits',
    'Infrastructure cap',
    'Team capacity',
    'Resource constraints'
  ]
};

/**
 * Generate operational pill based on context and metric
 */
export function generateOperationalPill(
  category: PillCategory,
  metricDirection?: 'positive' | 'negative' | 'neutral',
  _specificContext?: string
): string {
  const pills = OPERATIONAL_PILLS[category];
  
  // Filter pills by direction if specified
  let filteredPills = pills;
  if (metricDirection) {
    if (metricDirection === 'positive') {
      filteredPills = pills.filter(pill => 
        pill.includes('gain') || pill.includes('improvement') || 
        pill.includes('reduction') || pill.includes('optimization') ||
        pill.includes('benefit') || pill.includes('acceleration')
      );
    } else if (metricDirection === 'negative') {
      filteredPills = pills.filter(pill => 
        pill.includes('pressure') || pill.includes('conflict') || 
        pill.includes('delay') || pill.includes('bottleneck') ||
        pill.includes('lag') || pill.includes('strain') ||
        pill.includes('decline') || pill.includes('risk') ||
        pill.includes('shortage') || pill.includes('limit')
      );
    }
  }
  
  // Fallback to all pills if filtered set is empty
  if (filteredPills.length === 0) {
    filteredPills = pills;
  }
  
  return filteredPills[Math.floor(Math.random() * filteredPills.length)];
}

/**
 * Get diverse pill rotation to avoid repetition
 */
export function getPillRotation(count: number): PillCategory[] {
  const categories: PillCategory[] = [];
  const allCategories = Object.keys(OPERATIONAL_PILLS) as PillCategory[];
  
  // Rotate through categories with some randomness to avoid adjacency repetition
  for (let i = 0; i < count; i++) {
    const baseCategory = allCategories[i % allCategories.length];
    // 30% chance to use a different category for variety
    const category = Math.random() < 0.7 
      ? baseCategory 
      : allCategories[Math.floor(Math.random() * allCategories.length)];
    
    categories.push(category);
  }
  
  return categories;
}

/**
 * Map insight patterns to appropriate pill categories
 */
export function mapInsightToPillCategory(
  insightType: string,
  metricValue: number,
  baselineValue: number
): PillCategory {
  const isPositive = metricValue > baselineValue;
  const delta = Math.abs(metricValue - baselineValue);
  const percentChange = baselineValue !== 0 ? (delta / baselineValue) * 100 : 0;
  
  // Map insight types to categories
  if (insightType.includes('reopen') || insightType.includes('revert')) {
    return 'quality_concern';
  } else if (insightType.includes('review') || insightType.includes('merge')) {
    return percentChange > 20 ? 'workflow_issue' : 'efficiency_gain';
  } else if (insightType.includes('deployment') || insightType.includes('release')) {
    return isPositive ? 'stability_risk' : 'efficiency_gain';
  } else if (insightType.includes('cycle') || insightType.includes('throughput')) {
    return isPositive ? 'velocity_impact' : 'efficiency_gain';
  } else if (insightType.includes('capacity') || insightType.includes('load')) {
    return 'resource_pressure';
  } else if (insightType.includes('coordination') || insightType.includes('team')) {
    return 'coordination_problem';
  } else {
    // Default mapping based on direction
    return isPositive ? 'workflow_issue' : 'efficiency_gain';
  }
}

/**
 * Generate contextually appropriate pill
 */
export function generateContextualPill(
  insightType: string,
  metricValue: number,
  baselineValue: number,
  _aiModel?: string
): string {
  const category = mapInsightToPillCategory(insightType, metricValue, baselineValue);
  const isPositive = metricValue > baselineValue;
  const direction = isPositive ? 'positive' : 'negative';
  
  // For some categories, direction matters less
  const neutralCategories: PillCategory[] = ['workflow_issue', 'coordination_problem', 'capacity_constraint'];
  const finalDirection = neutralCategories.includes(category) ? 'neutral' : direction;
  
  return generateOperationalPill(category, finalDirection);
}

/**
 * Get pill color based on category and direction
 */
export function getPillColor(
  category: PillCategory,
  direction?: 'positive' | 'negative' | 'neutral'
): string {
  // Real platform color schemes (simplified)
  const colorMap: Record<PillCategory, Record<string, string>> = {
    workflow_issue: {
      positive: 'green',
      negative: 'red',
      neutral: 'yellow'
    },
    quality_concern: {
      positive: 'green',
      negative: 'red',
      neutral: 'orange'
    },
    efficiency_gain: {
      positive: 'green',
      negative: 'yellow',
      neutral: 'blue'
    },
    resource_pressure: {
      positive: 'blue',
      negative: 'red',
      neutral: 'orange'
    },
    coordination_problem: {
      positive: 'blue',
      negative: 'red',
      neutral: 'yellow'
    },
    stability_risk: {
      positive: 'green',
      negative: 'red',
      neutral: 'orange'
    },
    velocity_impact: {
      positive: 'green',
      negative: 'red',
      neutral: 'blue'
    },
    capacity_constraint: {
      positive: 'blue',
      negative: 'red',
      neutral: 'orange'
    }
  };
  
  return colorMap[category][direction || 'neutral'];
}
