#!/bin/bash
# Add cicdStage to correlation rules that are missing it

# ai-improves-ct (around line 2033)
sed -i.tmp1 '/id:.*ai-improves-ct.*Date.now()/,/metricId:.*eng.pr_cycle_time/ {
  /cicdStage:/!{
    /severity:.*highlight/a\
          cicdStage: '\''review-merge'\'',  // Added: Route to Review & Merge section
  }
}' performanceEngine.ts

# team-ai-throughput (around line 2357)
sed -i.tmp2 '/id:.*team-ai-throughput.*Date.now()/,/metricId:.*prod.output/ {
  /cicdStage:/!{
    /severity:.*opportunity/a\
          cicdStage: '\''plan-code'\'',  // Added: Route to Plan & Code section
  }
}' performanceEngine.ts

echo "✅ Added cicdStage to correlation rules"
rm -f performanceEngine.ts.tmp*
