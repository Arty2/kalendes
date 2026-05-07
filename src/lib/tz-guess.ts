const TZ_TOKENS: Array<{ patterns: string[]; tz: string }> = [
  { patterns: ['athens', 'greek', 'greece', 'ελλάδα', 'ελληνικ'], tz: 'Europe/Athens' },
  { patterns: ['london', 'uk', 'britain', 'british', 'england'], tz: 'Europe/London' },
  { patterns: ['paris', 'france', 'french'], tz: 'Europe/Paris' },
  { patterns: ['berlin', 'germany', 'german', 'munich', 'frankfurt', 'hamburg'], tz: 'Europe/Berlin' },
  { patterns: ['madrid', 'spain', 'spanish', 'barcelona'], tz: 'Europe/Madrid' },
  { patterns: ['rome', 'italy', 'italian', 'milan'], tz: 'Europe/Rome' },
  { patterns: ['amsterdam', 'netherlands', 'holland', 'dutch'], tz: 'Europe/Amsterdam' },
  { patterns: ['brussels', 'belgium'], tz: 'Europe/Brussels' },
  { patterns: ['vienna', 'austria', 'austrian'], tz: 'Europe/Vienna' },
  { patterns: ['zurich', 'geneva', 'switzerland', 'swiss'], tz: 'Europe/Zurich' },
  { patterns: ['stockholm', 'sweden', 'swedish'], tz: 'Europe/Stockholm' },
  { patterns: ['oslo', 'norway', 'norwegian'], tz: 'Europe/Oslo' },
  { patterns: ['copenhagen', 'denmark', 'danish'], tz: 'Europe/Copenhagen' },
  { patterns: ['helsinki', 'finland', 'finnish'], tz: 'Europe/Helsinki' },
  { patterns: ['warsaw', 'poland', 'polish'], tz: 'Europe/Warsaw' },
  { patterns: ['lisbon', 'portugal', 'portuguese'], tz: 'Europe/Lisbon' },
  { patterns: ['dublin', 'ireland', 'irish'], tz: 'Europe/Dublin' },
  { patterns: ['moscow', 'russia', 'russian'], tz: 'Europe/Moscow' },
  { patterns: ['istanbul', 'turkey', 'turkish'], tz: 'Europe/Istanbul' },
  { patterns: ['nicosia', 'cyprus', 'cypriot'], tz: 'Asia/Nicosia' },

  { patterns: ['new york', 'nyc', 'manhattan', 'brooklyn', 'usa', 'america', 'us holidays', 'eastern'], tz: 'America/New_York' },
  { patterns: ['chicago', 'central time'], tz: 'America/Chicago' },
  { patterns: ['denver', 'mountain time'], tz: 'America/Denver' },
  { patterns: ['los angeles', 'san francisco', 'la ', 'pacific'], tz: 'America/Los_Angeles' },
  { patterns: ['toronto', 'canada', 'canadian'], tz: 'America/Toronto' },
  { patterns: ['mexico', 'mexican'], tz: 'America/Mexico_City' },
  { patterns: ['são paulo', 'sao paulo', 'brazil', 'brasil'], tz: 'America/Sao_Paulo' },
  { patterns: ['buenos aires', 'argentina'], tz: 'America/Argentina/Buenos_Aires' },

  { patterns: ['tokyo', 'japan', 'japanese'], tz: 'Asia/Tokyo' },
  { patterns: ['seoul', 'korea', 'korean'], tz: 'Asia/Seoul' },
  { patterns: ['shanghai', 'beijing', 'china', 'chinese'], tz: 'Asia/Shanghai' },
  { patterns: ['hong kong', 'hongkong'], tz: 'Asia/Hong_Kong' },
  { patterns: ['singapore'], tz: 'Asia/Singapore' },
  { patterns: ['bangkok', 'thailand', 'thai'], tz: 'Asia/Bangkok' },
  { patterns: ['mumbai', 'delhi', 'india', 'indian'], tz: 'Asia/Kolkata' },
  { patterns: ['dubai', 'uae', 'emirates'], tz: 'Asia/Dubai' },
  { patterns: ['tel aviv', 'jerusalem', 'israel', 'israeli'], tz: 'Asia/Jerusalem' },

  { patterns: ['sydney', 'melbourne', 'australia', 'australian'], tz: 'Australia/Sydney' },
  { patterns: ['auckland', 'wellington', 'new zealand'], tz: 'Pacific/Auckland' },

  { patterns: ['cape town', 'johannesburg', 'south africa'], tz: 'Africa/Johannesburg' },
  { patterns: ['cairo', 'egypt'], tz: 'Africa/Cairo' },
  { patterns: ['lagos', 'nigeria'], tz: 'Africa/Lagos' },
];

export function guessTimezoneFromName(name: string): string | null {
  if (!name) return null;
  const haystack = name.toLowerCase();
  for (const entry of TZ_TOKENS) {
    for (const needle of entry.patterns) {
      if (haystack.includes(needle)) return entry.tz;
    }
  }
  return null;
}
