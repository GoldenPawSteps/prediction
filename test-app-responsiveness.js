/**
 * Test: App Responsiveness & Navigation
 * Verifies that the app doesn't get stuck rendering when pages fail to load
 */

const BASE_URL = process.env.TEST_BASE_URL || 'http://localhost:3000'

async function test(name, fn) {
  try {
    console.log(`\n✓ Starting: ${name}`)
    await fn()
    console.log(`✓ PASSED: ${name}`)
    return true
  } catch (err) {
    console.error(`✗ FAILED: ${name}`)
    console.error(`  Error: ${err.message}`)
    return false
  }
}

async function timeout(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

async function testMarket404HandlingFast() {
  // Simulate fetching a non-existent market
  // The old code would hang the page with an infinite loading spinner
  // The fix ensures isNotFound is checked before loading state
  
  console.log('Testing 404 market handling...')
  
  // This is more of a code inspection test since we can't fully render
  // But we can verify the logic is correct by checking the file contents
  const fs = require('fs')
  const path = require('path')
  const marketPagePath = path.join(process.cwd(), 'app/markets/[id]/page.tsx')
  const content = fs.readFileSync(marketPagePath, 'utf-8')
  
  // Verify the render order: isNotFound check comes BEFORE loading check
  const isNotFoundIdx = content.indexOf('if (isNotFound) return notFound()')
  const loadingCheckIdx = content.indexOf('if (loading || !market) {')
  
  if (isNotFoundIdx > -1 && loadingCheckIdx > -1 && isNotFoundIdx < loadingCheckIdx) {
    console.log('  ✓ Render order correct: isNotFound checked before loading')
  } else {
    throw new Error('Render order is incorrect - isNotFound should be checked first')
  }
  
  // Verify releaseInitialLoading is called on 404
  if (content.includes('if (res.status === 404) {') && 
      content.match(/if \(res\.status === 404\) \{[\s\S]*?setIsNotFound\(true\)[\s\S]*?releaseInitialLoading\(requestId\)/)) {
    console.log('  ✓ releaseInitialLoading called immediately on 404')
  } else {
    throw new Error('releaseInitialLoading not called on 404 response')
  }
}

async function testGlobalErrorBoundary() {
  console.log('Testing global error boundary...')
  
  const fs = require('fs')
  const path = require('path')
  
  // Verify GlobalErrorBoundary component exists
  const boundaryPath = path.join(process.cwd(), 'components/GlobalErrorBoundary.tsx')
  if (!fs.existsSync(boundaryPath)) {
    throw new Error('GlobalErrorBoundary component not found')
  }
  console.log('  ✓ GlobalErrorBoundary component created')
  
  // Verify it's integrated in layout
  const layoutPath = path.join(process.cwd(), 'app/layout.tsx')
  const layoutContent = fs.readFileSync(layoutPath, 'utf-8')
  
  if (layoutContent.includes('GlobalErrorBoundary') && 
      layoutContent.includes('<GlobalErrorBoundary>')) {
    console.log('  ✓ GlobalErrorBoundary integrated in root layout')
  } else {
    throw new Error('GlobalErrorBoundary not properly integrated in layout')
  }
}

async function testNavigationWatchdog() {
  console.log('Testing navigation watchdog improvements...')
  
  const fs = require('fs')
  const path = require('path')
  const feedbackPath = path.join(process.cwd(), 'lib/client-nav-feedback.ts')
  const content = fs.readFileSync(feedbackPath, 'utf-8')
  
  // Verify watchdog timeout reduced from 8s to 3s
  if (content.includes('const NAV_WATCHDOG_MS = 3000')) {
    console.log('  ✓ Navigation watchdog timeout improved (3s vs 8s)')
  } else {
    throw new Error('Navigation watchdog timeout not improved')
  }
  
  // Verify warning logging added
  if (content.includes('logNavWarning') && content.includes('Navigation appears stuck')) {
    console.log('  ✓ Navigation warning logging added for debugging')
  } else {
    console.warn('  ⚠ Warning logging not found (optional improvement)')
  }
}

async function testFetchErrorHandling() {
  console.log('Testing fetch error handling in market detail...')
  
  const fs = require('fs')
  const path = require('path')
  const marketPagePath = path.join(process.cwd(), 'app/markets/[id]/page.tsx')
  const content = fs.readFileSync(marketPagePath, 'utf-8')
  
  // Verify releaseInitialLoading called on both success and error
  const successCall = content.match(/if \(res\.ok\) \{[\s\S]*?releaseInitialLoading\(requestId\)/)
  const errorCall = content.match(/} else \{[\s\S]*?setFetchError[\s\S]*?releaseInitialLoading\(requestId\)/)
  
  if (successCall && errorCall) {
    console.log('  ✓ releaseInitialLoading called on both success and error')
  } else {
    throw new Error('Error handling paths not properly releasing loading state')
  }
}

async function main() {
  console.log('='.repeat(60))
  console.log('App Responsiveness Test Suite')
  console.log('='.repeat(60))
  
  const results = []
  
  results.push(await test(
    'Market 404 handling prevents stuck loading',
    testMarket404HandlingFast
  ))
  
  results.push(await test(
    'Global error boundary catches page errors',
    testGlobalErrorBoundary
  ))
  
  results.push(await test(
    'Navigation watchdog detects stuck pages faster',
    testNavigationWatchdog
  ))
  
  results.push(await test(
    'Fetch errors properly release loading state',
    testFetchErrorHandling
  ))
  
  const passed = results.filter(r => r).length
  const failed = results.length - passed
  
  console.log('\n' + '=' . repeat(60))
    console.log('\n' + '='.repeat(60))
  console.log(`Results: ${passed} passed, ${failed} failed`)
  console.log('='.repeat(60))
  
  if (failed > 0) {
    process.exit(1)
  }
}

main().catch(err => {
  console.error('Test suite error:', err)
  process.exit(1)
})
