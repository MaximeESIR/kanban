const url = process.env.VITE_SUPABASE_URL?.trim()
const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
function fail(message) {
  console.error(message)
  process.exit(1)
}
if (!url && !key && process.env.VITE_PUBLIC_DEMO === 'true') {
  console.log(
    'Public demo enabled: browser-only storage, no private authentication or synchronization.',
  )
  process.exit(0)
}
if (!url || !key)
  fail(
    'Set the VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY repository variables before deployment.',
  )
let parsed
try {
  parsed = new URL(url)
} catch {
  fail('Invalid Supabase URL.')
}
if (parsed.protocol !== 'https:' || !parsed.hostname.endsWith('.supabase.co'))
  fail('Use the HTTPS supabase.co URL of your project.')
if (key.startsWith('sb_secret_'))
  fail(
    'Secret keys MUST NOT be bundled in a website. Use a publishable key and rotate any exposed secret.',
  )
if (key.startsWith('eyJ')) {
  let payload
  try {
    payload = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString())
  } catch {
    fail('Invalid public key.')
  }
  if (payload.role !== 'anon')
    fail('Only the public anon key is accepted. Service role keys MUST NOT be published.')
} else if (!key.startsWith('sb_publishable_')) fail('Use a Supabase publishable key.')
console.log(
  'Public configuration verified. Remember to apply RLS and authorize your owner account.',
)
