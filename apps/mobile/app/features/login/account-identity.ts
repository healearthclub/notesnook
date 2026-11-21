// Account IDs are app-owned opaque identifiers; legacy Google-prefixed IDs remain stable.
export function isHealEarthAccountId(value:unknown):value is string {
  return typeof value==='string' && (/^google:[A-Za-z0-9_-]{1,255}$/.test(value) || /^usr_[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/.test(value));
}
