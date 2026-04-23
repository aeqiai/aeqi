#!/bin/bash
# Dependency security update script for AEQI project
# Updates dependencies to fix security vulnerabilities

set -euo pipefail

echo "=== AEQI Dependency Security Updates ==="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Function to print colored output
print_status() {
    local color=$1
    local message=$2
    echo -e "${color}${message}${NC}"
}

# Function to check if command exists
command_exists() {
    command -v "$1" >/dev/null 2>&1
}

# 1. Rust Dependencies
echo "=== Updating Rust Dependencies ==="

if command_exists cargo; then
    print_status $GREEN "Updating cargo dependencies..."
    cargo update
    
    # Check for outdated dependencies
    if command_exists cargo-outdated; then
        print_status $GREEN "Checking for outdated dependencies..."
        cargo outdated || true
    else
        print_status $YELLOW "⚠️  cargo-outdated not installed. Install with: cargo install cargo-outdated"
    fi
else
    print_status $RED "❌ cargo not found. Skipping Rust dependency updates."
fi

echo ""

# 2. JavaScript/TypeScript Dependencies
echo "=== Updating JavaScript/TypeScript Dependencies ==="

# Find npm projects
find_npm_projects() {
    find . -name "package.json" -type f | grep -v node_modules | head -10
}

npm_projects=$(find_npm_projects)

if [ -z "$npm_projects" ]; then
    print_status $YELLOW "⚠️  No npm projects found. Skipping JavaScript dependency updates."
else
    echo "Found npm projects:"
    echo "$npm_projects"
    echo ""
    
    if command_exists npm; then
        for project in $npm_projects; do
            project_dir=$(dirname "$project")
            print_status $GREEN "Updating dependencies for: $project_dir"
            
            cd "$project_dir"
            
            # Check current vulnerabilities
            print_status $GREEN "Checking for vulnerabilities..."
            npm audit 2>/dev/null || true
            
            # Update dependencies
            print_status $GREEN "Updating dependencies..."
            npm update
            
            # Try to fix vulnerabilities
            print_status $GREEN "Attempting to fix vulnerabilities..."
            npm audit fix 2>/dev/null || true
            
            # Check outdated dependencies
            print_status $GREEN "Checking for outdated dependencies..."
            npm outdated 2>/dev/null || true
            
            cd - > /dev/null
            echo ""
        done
    else
        print_status $RED "❌ npm not found. Skipping JavaScript dependency updates."
    fi
fi

echo ""

# 3. Generate Security Report
echo "=== Generating Security Report ==="

report_file="security-report-$(date +%Y%m%d-%H%M%S).txt"

{
    echo "AEQI Security Dependency Update Report"
    echo "Generated: $(date)"
    echo "======================================"
    echo ""
    
    echo "1. Rust Dependencies:"
    echo "-------------------"
    if command_exists cargo; then
        echo "Cargo version: $(cargo --version)"
        echo ""
        
        # Check for known vulnerabilities
        if command_exists cargo-audit; then
            echo "Security audit:"
            cargo audit 2>&1 | tail -20 || echo "Audit failed or no issues found"
        else
            echo "cargo-audit not installed"
        fi
    else
        echo "cargo not found"
    fi
    
    echo ""
    echo "2. JavaScript Dependencies:"
    echo "-------------------------"
    
    if [ -n "$npm_projects" ] && command_exists npm; then
        for project in $npm_projects; do
            project_dir=$(dirname "$project")
            echo "Project: $project_dir"
            echo ""
            
            cd "$project_dir"
            
            echo "npm version: $(npm --version)"
            echo ""
            
            echo "Vulnerability scan:"
            npm audit --json 2>/dev/null | jq -r '.metadata.vulnerabilities | "  Critical: \(.critical)\n  High: \(.high)\n  Moderate: \(.moderate)\n  Low: \(.low)"' || echo "  Audit failed"
            
            cd - > /dev/null
            echo ""
        done
    else
        echo "No npm projects or npm not found"
    fi
    
    echo ""
    echo "3. Recommendations:"
    echo "-----------------"
    echo "1. Review and apply security updates regularly"
    echo "2. Consider using Dependabot or Renovate for automated updates"
    echo "3. Test updates in a staging environment before production"
    echo "4. Monitor security advisories for critical dependencies"
    echo "5. Use lock files (Cargo.lock, package-lock.json) for reproducible builds"
    
} > "$report_file"

print_status $GREEN "Security report generated: $report_file"

echo ""
echo "=== Update Complete ==="
print_status $GREEN "Dependency security updates completed!"
echo ""
echo "Next steps:"
echo "1. Review the security report: cat $report_file"
echo "2. Run tests to ensure updates don't break functionality"
echo "3. Commit the updated lock files"
echo "4. Consider setting up automated security updates"

exit 0