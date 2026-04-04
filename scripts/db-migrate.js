#!/usr/bin/env node
require('dotenv/config')

const { spawnSync } = require('child_process')
const { resolveDatabaseUrl } = require('./db-url')

async function main() {
  const resolved = await resolveDatabaseUrl()
  const env = { ...process.env, DATABASE_URL: resolved.url }

  if (resolved.changed) {
    console.log(`ℹ️  DATABASE_URL host fallback: ${resolved.from} -> ${resolved.to}`)
  }

  const result = spawnSync('npx', ['prisma', 'migrate', 'deploy'], {
    stdio: 'inherit',
    env,
  })
  process.exit(result.status || 0)
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
