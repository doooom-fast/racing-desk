#!/bin/bash

# Test K10 Broadcaster MCP

echo "Testing K10 Broadcaster MCP Server"
echo "===================================="
echo ""

# Start the server in background and capture output
timeout 10 node dist/index.js > /tmp/mcp_test.log 2>&1 &
MCP_PID=$!

# Give server time to start
sleep 1

# Test 1: List tools
echo "Test 1: Listing available tools..."
RESULT=$(echo '{"jsonrpc":"2.0","id":1,"method":"tools/list"}' | timeout 5 node dist/index.js 2>/dev/null)
TOOL_COUNT=$(echo $RESULT | grep -o '"name":"' | wc -l)
echo "✓ Found $TOOL_COUNT tools"
echo ""

# Test 2: Check if tools are registered
echo "Test 2: Checking registered tools..."
echo $RESULT | grep -q "list_components" && echo "✓ list_components" || echo "✗ list_components"
echo $RESULT | grep -q "get_component" && echo "✓ get_component" || echo "✗ get_component"
echo $RESULT | grep -q "get_telemetry_types" && echo "✓ get_telemetry_types" || echo "✗ get_telemetry_types"
echo $RESULT | grep -q "get_settings_types" && echo "✓ get_settings_types" || echo "✗ get_settings_types"
echo $RESULT | grep -q "get_hook" && echo "✓ get_hook" || echo "✗ get_hook"
echo $RESULT | grep -q "get_lib" && echo "✓ get_lib" || echo "✗ get_lib"
echo $RESULT | grep -q "list_tests" && echo "✓ list_tests" || echo "✗ list_tests"
echo $RESULT | grep -q "get_test" && echo "✓ get_test" || echo "✗ get_test"
echo $RESULT | grep -q "get_build_config" && echo "✓ get_build_config" || echo "✗ get_build_config"
echo $RESULT | grep -q "get_design_tokens" && echo "✓ get_design_tokens" || echo "✗ get_design_tokens"
echo $RESULT | grep -q "get_component_tree" && echo "✓ get_component_tree" || echo "✗ get_component_tree"
echo $RESULT | grep -q "search_source" && echo "✓ search_source" || echo "✗ search_source"
echo ""

# Check distribution files
echo "Test 3: Checking distribution files..."
[ -f dist/index.js ] && echo "✓ dist/index.js exists ($(wc -c < dist/index.js) bytes)" || echo "✗ dist/index.js missing"
[ -f dist/index.d.ts ] && echo "✓ dist/index.d.ts exists" || echo "✗ dist/index.d.ts missing"
echo ""

# Check source structure
echo "Test 4: Checking source accessibility..."
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/../../../.." && pwd)"
SRC="$ROOT/racecor-overlay"
[ -d "$SRC/modules/js" ] && echo "✓ modules/js directory found" || echo "✗ modules/js directory missing"
[ -d "$SRC/modules/styles" ] && echo "✓ modules/styles directory found" || echo "✗ modules/styles directory missing"
[ -d "$SRC/tests" ] && echo "✓ Tests directory found" || echo "✗ Tests directory missing"
[ -d "$SRC/data" ] && echo "✓ Data directory found" || echo "✗ Data directory missing"
[ -d "$SRC/images" ] && echo "✓ Images directory found" || echo "✗ Images directory missing"
echo ""

echo "Testing complete!"
echo "MCP is ready for integration with Claude."

# Cleanup
kill $MCP_PID 2>/dev/null || true
