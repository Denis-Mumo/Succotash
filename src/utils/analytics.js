function percent(n, d) { return d ? Math.round((n / d) * 1000) / 10 : 0; }
function buildReport(campaign, events, codes, locations) {
  const human = events.filter(e => e.classification === 'possible_human' || e.classification === 'confirmed_human');
  const automated = events.filter(e => e.classification === 'likely_automated');
  return {
    objective: campaign.objective || campaign.description || 'Not specified', campaign: campaign.name,
    duration: { startsAt: campaign.starts_at, endsAt: campaign.ends_at }, activeQrCodes: codes,
    approvedLocations: locations, totalRequests: events.length,
    estimatedUniqueInteractions: new Set(human.map(e => e.qr_code_id)).size,
    confirmedInteractions: events.filter(e => e.classification === 'confirmed_human').length,
    potentialAutomatedTraffic: automated.length,
    locationRates: [],
    limitations: 'A request is not proof of a human scan. Unique interaction estimates count distinct QR codes with a recorded deliberate follow-up action, not distinct people. User-agent classification is heuristic; no identity, precise location, or device fingerprint is collected.',
    followUpTopics: ['Pause before scanning unexpected QR codes', 'Inspect the destination URL', 'Report suspicious QR codes through approved channels'],
    denominatorAvailable: false,
  };
}
module.exports = { percent, buildReport };
