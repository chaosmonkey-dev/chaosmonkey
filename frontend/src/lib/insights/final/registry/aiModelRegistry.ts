/**
 * Canonical AI Model Registry
 * 
 * Centralized registry for all AI coding models used in Performance Insights.
 * Ensures consistent naming, eliminates drift, and provides model diversity.
 */

export interface AIModel {
  id: string;
  canonicalName: string;
  shortName: string;
  vendor: string;
  modelType: 'llm' | 'agent' | 'specialized';
  capabilities: string[];
  usageContext: 'coding' | 'review' | 'testing' | 'orchestration';
}

export const CANONICAL_AI_MODELS: readonly AIModel[] = [
  // Anthropic Models
  {
    id: 'claude-sonnet-4.6',
    canonicalName: 'Claude Sonnet 4.6',
    shortName: 'Sonnet 4.6',
    vendor: 'Anthropic',
    modelType: 'llm',
    capabilities: ['sustained-execution', 'architecture-refactor', 'implementation-heavy'],
    usageContext: 'coding'
  },
  {
    id: 'claude-sonnet-4.5',
    canonicalName: 'Claude Sonnet 4.5',
    shortName: 'Sonnet 4.5',
    vendor: 'Anthropic',
    modelType: 'llm',
    capabilities: ['code-generation', 'review', 'documentation'],
    usageContext: 'coding'
  },
  {
    id: 'claude-opus-4.2',
    canonicalName: 'Claude Opus 4.2',
    shortName: 'Opus 4.2',
    vendor: 'Anthropic',
    modelType: 'llm',
    capabilities: ['remediation-debugging', 'incident-response', 'complex-problem-solving'],
    usageContext: 'coding'
  },
  
  // OpenAI Models
  {
    id: 'gpt-5-coding',
    canonicalName: 'GPT-5 Coding',
    shortName: 'GPT-5',
    vendor: 'OpenAI',
    modelType: 'llm',
    capabilities: ['review-turnaround', 'implementation-heavy', 'code-generation'],
    usageContext: 'coding'
  },
  {
    id: 'gpt-4-turbo',
    canonicalName: 'GPT-4 Turbo',
    shortName: 'GPT-4T',
    vendor: 'OpenAI',
    modelType: 'llm',
    capabilities: ['code-generation', 'review', 'debugging'],
    usageContext: 'coding'
  },
  
  // Google Models
  {
    id: 'gemini-2.6-pro',
    canonicalName: 'Gemini 2.6 Pro',
    shortName: 'Gemini Pro',
    vendor: 'Google',
    modelType: 'llm',
    capabilities: ['repository-analysis', 'large-context', 'multimodal'],
    usageContext: 'coding'
  },
  {
    id: 'gemini-2.6-flash',
    canonicalName: 'Gemini 2.6 Flash',
    shortName: 'Gemini Flash',
    vendor: 'Google',
    modelType: 'llm',
    capabilities: ['fast-generation', 'autocomplete', 'refactoring'],
    usageContext: 'coding'
  },
  
  // Specialized Models
  {
    id: 'swe-1.6',
    canonicalName: 'SWE-1.6',
    shortName: 'SWE-1.6',
    vendor: 'OpenAI',
    modelType: 'specialized',
    capabilities: ['rapid-iteration', 'high-throughput', 'variance-analysis'],
    usageContext: 'coding'
  },
  {
    id: 'kimi-k2.6',
    canonicalName: 'Kimi K2.6',
    shortName: 'Kimi K2.6',
    vendor: 'Moonshot',
    modelType: 'llm',
    capabilities: ['accelerated-iteration', 'experimental-workflows', 'long-context'],
    usageContext: 'coding'
  },
  {
    id: 'deepseek-coder-v3',
    canonicalName: 'DeepSeek-Coder V3',
    shortName: 'DeepSeek V3',
    vendor: 'DeepSeek',
    modelType: 'specialized',
    capabilities: ['infra-platform', 'self-hosted', 'optimization'],
    usageContext: 'coding'
  },
  {
    id: 'codestral-2',
    canonicalName: 'Codestral 2',
    shortName: 'Codestral 2',
    vendor: 'Mistral',
    modelType: 'specialized',
    capabilities: ['code-generation', 'review', 'testing'],
    usageContext: 'coding'
  },
  {
    id: 'copilot-native',
    canonicalName: 'GPT-5 Coding',
    shortName: 'GPT-5',
    vendor: 'Microsoft',
    modelType: 'specialized',
    capabilities: ['autocomplete', 'inline-suggestions', 'refactoring'],
    usageContext: 'coding'
  },
  {
    id: 'llama-4-code',
    canonicalName: 'Llama 4 Code',
    shortName: 'Llama 4',
    vendor: 'Meta',
    modelType: 'llm',
    capabilities: ['code-generation', 'review', 'optimization'],
    usageContext: 'coding'
  },
  {
    id: 'grok-code-fast-1',
    canonicalName: 'Grok Code Fast-1',
    shortName: 'Grok Fast-1',
    vendor: 'xAI',
    modelType: 'specialized',
    capabilities: ['fast-generation', 'debugging', 'testing'],
    usageContext: 'coding'
  }
] as const;

// Helper functions
export function getAIModelById(id: string): AIModel | undefined {
  return CANONICAL_AI_MODELS.find(model => model.id === id);
}

export function getAIModelByShortName(shortName: string): AIModel | undefined {
  return CANONICAL_AI_MODELS.find(model => model.shortName === shortName);
}

export function getAIModelsByVendor(vendor: string): AIModel[] {
  return CANONICAL_AI_MODELS.filter(model => model.vendor === vendor);
}

export function getAIModelsByContext(context: AIModel['usageContext']): AIModel[] {
  return CANONICAL_AI_MODELS.filter(model => model.usageContext === context);
}

export function getRandomAIModel(): AIModel {
  const randomIndex = Math.floor(Math.random() * CANONICAL_AI_MODELS.length);
  return CANONICAL_AI_MODELS[randomIndex];
}

export function getDiverseAIModels(count: number): AIModel[] {
  const shuffled = [...CANONICAL_AI_MODELS].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, count);
}

// Model combinations for realistic workflow diversity
export const WORKFLOW_MODEL_COMBINATIONS = {
  // High-performance combinations
  accelerated: ['claude-sonnet-4.6', 'gpt-5-coding', 'gemini-2.6-pro'],
  
  // Stable combinations  
  stable: ['claude-sonnet-4.5', 'gpt-4-turbo', 'deepseek-coder-v3'],
  
  // Experimental combinations
  experimental: ['claude-opus-4.2', 'swe-1.6', 'llama-4-code'],
  
  // Fast-paced combinations
  rapid: ['gemini-2.6-flash', 'grok-code-fast-1', 'codestral-2'],
  
  // Review-focused combinations
  review: ['claude-sonnet-4.6', 'deepseek-coder-v3', 'copilot-native'],
  
  // Documentation-heavy combinations
  documentation: ['kimi-k2.6', 'claude-opus-4.2', 'gemini-2.6-pro']
} as const;

export type AIModelID = typeof CANONICAL_AI_MODELS[number]['id'];
export type AIModelName = typeof CANONICAL_AI_MODELS[number]['canonicalName'];
export type AIModelShortName = typeof CANONICAL_AI_MODELS[number]['shortName'];
