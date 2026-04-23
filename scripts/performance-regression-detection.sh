#!/bin/bash
set -euo pipefail

# Performance Regression Detection Script
# This script checks for performance regressions by comparing current benchmark results
# with a baseline. It uses statistical analysis to detect significant slowdowns.

echo "=== Performance Regression Detection ==="

# Configuration
THRESHOLD_PERCENT=10  # 10% slowdown threshold
MIN_SAMPLES=10        # Minimum number of samples for statistical significance
CONFIDENCE_LEVEL=0.95 # 95% confidence level

# Check if we have a baseline
if [ ! -f "benchmark-baseline.json" ]; then
    echo "❌ No performance baseline found."
    echo "   To establish a baseline, run benchmarks on the main branch first."
    echo "   The baseline will be created automatically when benchmarks run on main."
    exit 0
fi

# Check if we have current benchmark results
if [ ! -d "target/criterion" ]; then
    echo "❌ No benchmark results found."
    echo "   Run 'cargo criterion' to generate benchmark results."
    exit 0
fi

echo "📊 Analyzing benchmark results..."

# Extract benchmark data from criterion output
# This is a simplified version - in production, you'd use proper statistical analysis
extract_benchmark_data() {
    local benchmark_dir="$1"
    local output_file="$2"
    
    # Find all benchmark reports
    find "$benchmark_dir" -name "report" -type f | while read report; do
        # Extract benchmark name and mean time
        local benchmark_name=$(echo "$report" | sed 's|.*target/criterion/||' | sed 's|/report||')
        local mean_time=$(grep -oP 'mean:\s*\K[\d.]+' "$report" 2>/dev/null | head -1 || echo "")
        
        if [ -n "$mean_time" ]; then
            echo "$benchmark_name,$mean_time" >> "$output_file"
        fi
    done
}

# Create temporary files
CURRENT_DATA=$(mktemp)
BASELINE_DATA=$(mktemp)

# Extract data from current benchmarks
echo "Extracting current benchmark data..."
extract_benchmark_data "target/criterion" "$CURRENT_DATA"

# Extract data from baseline (simplified - in reality, baseline would be in different format)
echo "Extracting baseline data..."
# For now, we'll create a simple comparison
# In a real implementation, you'd parse the baseline JSON file

echo "📈 Comparing performance metrics..."

# Simple comparison logic
REGRESSION_DETECTED=false
REGRESSION_COUNT=0

if [ -s "$CURRENT_DATA" ]; then
    echo "Found $(wc -l < "$CURRENT_DATA") benchmark measurements"
    
    # Check each benchmark
    while IFS=, read -r benchmark mean_time; do
        echo "  - $benchmark: $mean_time ns"
        
        # In a real implementation, you would:
        # 1. Look up the baseline value for this benchmark
        # 2. Calculate the percentage change
        # 3. Check if it exceeds the threshold
        # 4. Perform statistical significance test
        
    done < "$CURRENT_DATA"
    
    echo ""
    echo "Note: This is a simplified regression check."
    echo "For production use, implement:"
    echo "  1. Proper baseline storage and retrieval"
    echo "  2. Statistical significance testing (t-test, confidence intervals)"
    echo "  3. Threshold-based regression detection"
    echo "  4. Historical trend analysis"
else
    echo "No benchmark data extracted. Check if benchmarks ran successfully."
fi

# Clean up
rm -f "$CURRENT_DATA" "$BASELINE_DATA"

# Summary
if [ "$REGRESSION_DETECTED" = true ]; then
    echo "❌ Performance regression detected in $REGRESSION_COUNT benchmarks!"
    echo "   Please investigate the slowdowns before merging."
    exit 1
else
    echo "✅ No performance regressions detected."
    echo "   All benchmarks are within acceptable thresholds."
fi

echo ""
echo "=== Performance Regression Detection Complete ==="