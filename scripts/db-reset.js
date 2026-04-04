#!/usr/bin/env node
require('dotenv/config')

const { spawnSync } = require('child_process')
const { resolveDatabaseUrl } = require('./db-url')

function run(cmd, args, env) {
  const result = spawnSync(cmd, args, {
    stdio: 'inherit',
    env,
  })
  if (result.status !== 0) {
    process.exit(result.status || 1)
  }
}

async function main() {
  const resolved = await resolveDatabaseUrl()
  const env = { ...process.env, DATABASE_URL: resolved.url }

  if (resolved.changed) {
    console.log(`ℹ️  DATABASE_URL host fallback: ${resolved.from} -> ${resolved.to}`)
  }

  run('npx', ['prisma', 'migrate', 'reset', '--force'], env)
  run('npm', ['run', 'seed'], env)
}

main().catch((err) => {
  console.error(`\n${err.message}`)
  process.exit(1)
})
