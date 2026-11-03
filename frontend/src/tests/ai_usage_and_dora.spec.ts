import { mount } from '@vue/test-utils'
import AIUsageSignalsSection from '../components/performance/AIUsageSignalsSection.vue'
import DoraMetricsSection from '../components/performance/DoraMetricsSection.vue'

describe('AI Usage & DORA UI smoke', () => {
  it('renders AI usage cards and missing coverage', () => {
    const metrics = [
      { id: 'ai_assist_rate', topIde: 'Cursor', hasCoverage: true },
      { id: 'ai_review_presence', hasCoverage: false }
    ]
    const wrapper = mount(AIUsageSignalsSection as any, { props: { metrics } })
    expect(wrapper.text()).toContain('AI Usage Signals describe how AI tools are being used')
    expect(wrapper.text()).toContain('Higher usage does not imply better delivery outcomes.')
    expect(wrapper.text()).toContain('Insufficient telemetry coverage to display this signal.')
  })

  it('renders DORA metrics and missing-data state', () => {
    const dora = [
      { name: 'Lead Time for Changes', value: '2 days', missingState: null, source: 'GitHub PR telemetry', confidence: 'High', note: 'Estimated from PR' },
      { name: 'Mean Time to Recovery (MTTR)', value: null, missingState: 'insufficient_history', source: 'GitHub', confidence: 'Low', note: 'Estimated from incidents' }
    ]
    const wrapper = mount(DoraMetricsSection as any, { props: { metrics: dora } })
    expect(wrapper.text()).toContain('DORA Metrics reflect delivery outcomes')
    expect(wrapper.text()).toContain('Operational signal: Elevated release risk')
    expect(wrapper.text()).toContain('Insufficient historical data')
  })
})
