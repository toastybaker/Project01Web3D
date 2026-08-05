process.env.SERVE_STATIC = '1'
process.env.PORT ??= '4173'

await import('./index.ts')
