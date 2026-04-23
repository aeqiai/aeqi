#!/bin/bash
# Security scanning script for AEQI project
# Runs security scans for both Rust and JavaScript dependencies

set -euo pipefail

echo "=== AEQI Security Scanning ==="
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

# 1. Rust Security Scanning
echo "=== Rust Security Scanning ==="

if command_exists cargo; then
    # Check for cargo-audit
    if command_exists cargo-audit; then
        print_status $GREEN "Running cargo-audit..."
        cargo audit
        if [ $? -eq 0 ]; then
            print_status $GREEN "✅ cargo-audit passed"
        else
            print_status $RED "❌ cargo-audit found vulnerabilities"
            exit 1
        fi
    else
        print_status $YELLOW "⚠️  cargo-audit not installed. Installing..."
        cargo install cargo-audit
        cargo audit
    fi
    
    # Check for cargo-deny
    if command_exists cargo-deny; then
        print_status $GREEN "Running cargo-deny..."
        cargo deny check
        if [ $? -eq 0 ]; then
            print_status $GREEN "✅ cargo-deny passed"
        else
            print_status $RED "❌ cargo-deny found issues"
            exit 1
        fi
    else
        print_status $YELLOW "⚠️  cargo-deny not installed. Installing..."
        cargo install cargo-deny
        cargo deny check
    fi
else
    print_status $RED "❌ cargo not found. Skipping Rust security scanning."
fi

echo ""

# 2. JavaScript Security Scanning
echo "=== JavaScript Security Scanning ==="

# Check for npm projects
find_npm_projects() {
    find . -name "package.json" -type f | grep -v node_modules | head -10
}

npm_projects=$(find_npm_projects)

if [ -z "$npm_projects" ]; then
    print_status $YELLOW "⚠️  No npm projects found. Skipping JavaScript security scanning."
else
    echo "Found npm projects:"
    echo "$npm_projects"
    echo ""
    
    # Check for npm
    if command_exists npm; then
        for project in $npm_projects; do
            project_dir=$(dirname "$project")
            print_status $GREEN "Scanning project: $project_dir"
            
            # Check if package-lock.json exists
            if [ -f "$project_dir/package-lock.json" ]; then
                cd "$project_dir"
                
                # Run npm audit
                print_status $GREEN "Running npm audit..."
                npm audit
                audit_exit=$?
                
                if [ $audit_exit -eq 0 ]; then
                    print_status $GREEN "✅ npm audit passed for $project_dir"
                elif [ $audit_exit -eq 1 ]; then
                    print_status $RED "❌ npm audit found vulnerabilities in $project_dir"
                    echo "Vulnerabilities found. Consider running 'npm audit fix' to automatically fix issues."
                    
                    # Show audit report
                    npm audit --json | jq -r '.metadata.vulnerabilities | to_entries[] | "  \(.key): \(.value)"' 2>/dev/null || true
                    
                    # Ask if we should try to fix
                    read -p "Attempt to fix vulnerabilities with 'npm audit fix'? (y/N): " -n 1 -r
                    echo
                    if [[ $REPLY =~ ^[Yy]$ ]]; then
                        npm audit fix
                    fi
                    
                    exit 1
                else
                    print_status $YELLOW "⚠️  npm audit exited with code $audit_exit for $project_dir"
                fi
                
                cd - > /dev/null
            else
                print_status $YELLOW "⚠️  No package-lock.json found in $project_dir. Skipping audit."
            fi
        done
    else
        print_status $RED "❌ npm not found. Skipping JavaScript security scanning."
    fi
fi

echo ""

# 3. Secret Scanning
echo "=== Secret Scanning ==="

if command_exists grep; then
    print_status $GREEN "Scanning for potential secrets in code..."
    
    # Patterns to check for
    patterns=(
        "password\s*=\s*['\"][^'\"]*['\"]"
        "secret\s*=\s*['\"][^'\"]*['\"]"
        "token\s*=\s*['\"][^'\"]*['\"]"
        "key\s*=\s*['\"][^'\"]*['\"]"
        "api[_-]key\s*=\s*['\"][^'\"]*['\"]"
        "bearer\s*['\"][^'\"]*['\"]"
        "jwt\s*['\"][^'\"]*['\"]"
        "private[_-]key\s*=\s*['\"][^'\"]*['\"]"
        "aws[_-]access[_-]key[_-]id\s*=\s*['\"][^'\"]*['\"]"
        "aws[_-]secret[_-]access[_-]key\s*=\s*['\"][^'\"]*['\"]"
    )
    
    found_secrets=false
    
    for pattern in "${patterns[@]}"; do
        matches=$(grep -r -i -n --include="*.rs" --include="*.js" --include="*.ts" --include="*.json" --include="*.toml" --include="*.yml" --include="*.yaml" --include="*.env" --include="*.env.*" "$pattern" . 2>/dev/null | grep -v node_modules | grep -v target || true)
        
        if [ -n "$matches" ]; then
            found_secrets=true
            print_status $RED "Potential secrets found with pattern: $pattern"
            echo "$matches"
            echo ""
        fi
    done
    
    if [ "$found_secrets" = false ]; then
        print_status $GREEN "✅ No obvious secrets found in code"
    else
        print_status $YELLOW "⚠️  Potential secrets found. Please review and remove hardcoded secrets."
        echo "Consider using environment variables or a secret management system."
    fi
else
    print_status $RED "❌ grep not found. Skipping secret scanning."
fi

echo ""

# 4. File Permission Checking
echo "=== File Permission Checking ==="

print_status $GREEN "Checking for world-writable files..."
world_writable=$(find . -type f -perm -o+w 2>/dev/null | grep -v node_modules | grep -v target | head -20 || true)

if [ -n "$world_writable" ]; then
    print_status $YELLOW "⚠️  World-writable files found:"
    echo "$world_writable"
    echo ""
    echo "Consider tightening permissions with: chmod o-w <file>"
else
    print_status $GREEN "✅ No world-writable files found"
fi

echo ""

# 5. Summary
echo "=== Security Scan Summary ==="
print_status $GREEN "Security scanning completed!"
echo ""
echo "Recommendations:"
echo "1. Regularly update dependencies: cargo update / npm update"
echo "2. Review security advisories: https://rustsec.org / https://www.npmjs.com/advisories"
echo "3. Use secret management for sensitive data"
echo "4. Keep security tools updated: cargo-audit, cargo-deny, npm audit"
echo "5. Run security scans before each release"

exit 0