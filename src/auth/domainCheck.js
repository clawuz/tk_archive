const ALLOWED_DOMAINS = ['tribalistanbul.com', 'twist.ddb.com']

export function isAllowedDomain(email) {
  if (!email || !email.includes('@')) return false
  const domain = email.split('@')[1]
  return ALLOWED_DOMAINS.includes(domain)
}
