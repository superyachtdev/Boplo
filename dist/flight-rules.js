/* Boplo Flight — countries, authorities and published licence minimums.
   Figures are published regulatory minimums, checked against the sources listed.
   They are guidance for the user's own planning, not an assessment of eligibility.
   Update `checked` whenever a figure is re-verified. */
window.BOPLO_RULES = (() => {
  const checked = '2026-10-21';

  // Licensing systems with tailored licence options
  const regimes = {
    uk: {
      label: 'UK CAA', name: 'UK Civil Aviation Authority',
      licences: [
        { id: 'PPL(A)', label: 'PPL(A) · Private Pilot Licence', minHours: 40,
          summary: 'At least 40 hours as pilot of aeroplanes, including 10 hours of supervised solo and a solo cross-country flight.',
          source: 'UK CAA licensing and training simplification, in force from 1 October 2025',
          url: 'https://www.caa.co.uk/media/evqlejld/lts-project-webinar-presentation-sep-2025.pdf' },
        { id: 'NPPL(A)', label: 'NPPL(A) · National Private Pilot Licence', minHours: 32,
          summary: 'At least 32 hours of flight time, including at least 10 hours of supervised solo. UK-only privileges.',
          source: 'UK CAA licensing changes from 1 October 2025 (summary by FLYER)',
          url: 'https://flyer.co.uk/caa-simple-explanation-of-upcoming-changes-to-pilot-licensing/' },
        { id: 'LAPL(A)', label: 'LAPL(A) · existing holders only', minHours: null,
          summary: 'The UK CAA stopped issuing new LAPL(A) licences on 1 October 2025. Existing licences remain valid.',
          source: 'UK CAA licensing and training simplification',
          url: 'https://www.caa.co.uk/media/evqlejld/lts-project-webinar-presentation-sep-2025.pdf' }
      ]
    },
    easa: {
      label: 'EASA', name: 'EASA rules, via your national aviation authority',
      licences: [
        { id: 'PPL(A)', label: 'PPL(A) · Private Pilot Licence', minHours: 45,
          summary: 'At least 45 hours of flight instruction (up to 5 in a simulator), including 25 hours dual and 10 hours supervised solo, of which 5 hours solo cross-country with one flight of at least 270 km (150 NM).',
          source: 'Part-FCL, FCL.210.A',
          url: 'https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-aircrew-regulation-eu-no?page=10' },
        { id: 'LAPL(A)', label: 'LAPL(A) · Light Aircraft Pilot Licence', minHours: 30,
          summary: 'At least 30 hours of flight instruction, including 15 hours dual and 6 hours supervised solo, of which 3 hours solo cross-country with one flight of at least 150 km (80 NM).',
          source: 'Part-FCL, FCL.110.A',
          url: 'https://www.easa.europa.eu/en/document-library/easy-access-rules/online-publications/easy-access-rules-aircrew-regulation-eu-no?page=7' }
      ]
    },
    faa: {
      label: 'FAA', name: 'Federal Aviation Administration',
      licences: [
        { id: 'Private Pilot', label: 'Private Pilot certificate', minHours: 40,
          summary: 'At least 40 hours of flight time, including 20 hours of training with an instructor and 10 hours of solo, with set cross-country, night and instrument training.',
          source: '14 CFR § 61.109(a)',
          url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-E/section-61.109' },
        { id: 'Sport Pilot', label: 'Sport Pilot certificate', minHours: 20,
          summary: 'At least 20 hours of flight time, including 15 hours of training with an instructor and 5 hours of solo.',
          source: '14 CFR § 61.313(a)',
          url: 'https://www.law.cornell.edu/cfr/text/14/61.313' },
        { id: 'Recreational Pilot', label: 'Recreational Pilot certificate', minHours: 30,
          summary: 'At least 30 hours of flight time, including 15 hours of training with an instructor and 3 hours of solo.',
          source: '14 CFR § 61.99',
          url: 'https://www.ecfr.gov/current/title-14/chapter-I/subchapter-D/part-61/subpart-D/section-61.99' }
      ]
    },
    tc: {
      label: 'Transport Canada', name: 'Transport Canada Civil Aviation',
      licences: [
        { id: 'PPL', label: 'Private Pilot Licence (aeroplane)', minHours: 45,
          summary: 'At least 45 hours of flight time, including 17 hours dual and 12 hours solo.',
          source: 'CARs Standard 421, private pilot licence (aeroplane)',
          url: 'https://tc.canada.ca/en/corporate-services/acts-regulations/list-regulations/canadian-aviation-regulations-sor-96-433/standards/standard-421-flight-crew-permits-licences-ratings-canadian-aviation-regulations-cars' },
        { id: 'Recreational Pilot Permit', label: 'Recreational Pilot Permit (aeroplane)', minHours: 25,
          summary: 'At least 25 hours of flight time, including 15 hours dual and 5 hours solo.',
          source: 'CARs Standard 421, recreational pilot permit (aeroplane)',
          url: 'https://tc.canada.ca/en/corporate-services/acts-regulations/list-regulations/canadian-aviation-regulations-sor-96-433/standards/standard-421-flight-crew-permits-licences-ratings-canadian-aviation-regulations-cars' }
      ]
    },
    casa: {
      label: 'CASA', name: 'Civil Aviation Safety Authority (Australia)',
      licences: [
        { id: 'PPL', label: 'Private Pilot Licence (aeroplane)', minHours: 40,
          summary: 'At least 40 hours of aeronautical experience (35 in an integrated course), including 10 hours solo and 5 hours solo cross-country with a flight of at least 150 NM.',
          source: 'CASR Part 61, regulations 61.525 and 61.545',
          url: 'https://www.casa.gov.au/index.php/non-legislative-instrument/completion-solo-flight-hours-required-private-pilot-licence-flight-test-james-leslie-langan' },
        { id: 'RPL', label: 'Recreational Pilot Licence (aeroplane)', minHours: 25,
          summary: 'At least 25 hours of aeronautical experience.',
          source: 'CASR Part 61 recreational pilot licence (summary: Pilot licensing in Australia)',
          url: 'https://en.wikipedia.org/wiki/Pilot_licensing_in_Australia' }
      ]
    },
    nz: {
      label: 'CAA New Zealand', name: 'Civil Aviation Authority of New Zealand',
      licences: [
        { id: 'PPL', label: 'Private Pilot Licence (aeroplane)', minHours: 50,
          summary: 'At least 50 hours as pilot, made up of solo, dual, instrument and cross-country time. 40 hours if you won’t fly cross-country.',
          source: 'Civil Aviation Rules Part 61, rule 61.153',
          url: 'https://www.aviation.govt.nz/rules/rule-part/part-61/subpart-d/' }
      ]
    },
    icao: {
      label: 'Other authority', name: 'Your national aviation authority',
      licences: [
        { id: 'PPL', label: 'Private Pilot Licence (ICAO)', minHours: 40,
          summary: 'The international baseline is at least 40 hours of flight time (35 in an approved course). Your national rules may add more.',
          source: 'ICAO Annex 1 baseline, as referenced by the UK CAA',
          url: 'https://www.caa.co.uk/media/evqlejld/lts-project-webinar-presentation-sep-2025.pdf' }
      ]
    }
  };
  // Options available everywhere
  const common = [
    { id: 'Next rating', label: 'A further rating', minHours: null, summary: 'Track flying toward a rating such as night, IR(R) or tailwheel. Requirements depend on the rating.', source: '', url: '' },
    { id: 'Exploring flight training', label: 'Still exploring', minHours: null, summary: 'Log trial lessons and early flights while you decide.', source: '', url: '' }
  ];

  // EASA states (EU + Iceland, Liechtenstein, Norway, Switzerland) and the authority people know them by
  const easaAuthorities = {
    AT: 'Austro Control', BE: 'Belgian Civil Aviation Authority', BG: 'DG Civil Aviation Administration', HR: 'Croatian Civil Aviation Agency',
    CY: 'Department of Civil Aviation', CZ: 'Civil Aviation Authority of the Czech Republic', DK: 'Danish Civil Aviation and Railway Authority',
    EE: 'Estonian Transport Administration', FI: 'Traficom', FR: 'DGAC', DE: 'Luftfahrt-Bundesamt (LBA)', GR: 'Hellenic Civil Aviation Authority',
    HU: 'Hungarian aviation authority', IE: 'Irish Aviation Authority', IT: 'ENAC', LV: 'Civil Aviation Agency of Latvia', LT: 'Transport Competence Agency',
    LU: 'Direction de l’Aviation Civile', MT: 'Transport Malta, Civil Aviation Directorate', NL: 'ILT', PL: 'Civil Aviation Authority of Poland (ULC)',
    PT: 'ANAC', RO: 'Romanian Civil Aeronautical Authority', SK: 'Transport Authority', SI: 'Civil Aviation Agency', ES: 'AESA', SE: 'Swedish Transport Agency',
    IS: 'Icelandic Transport Authority', LI: 'Federal Office of Civil Aviation (FOCA)', NO: 'Civil Aviation Authority Norway', CH: 'Federal Office of Civil Aviation (FOCA)'
  };
  const regimeFor = code => code === 'GB' ? 'uk' : code === 'US' ? 'faa' : code === 'CA' ? 'tc' : code === 'AU' ? 'casa' : code === 'NZ' ? 'nz' : easaAuthorities[code] ? 'easa' : 'icao';
  const authorityFor = code => { const r = regimeFor(code); return r === 'easa' ? `${easaAuthorities[code]} (EASA)` : r === 'icao' ? '' : regimes[r].label; };

  // ISO 3166-1 alpha-2, names come from the browser
  const codes = 'AF AX AL DZ AS AD AO AI AQ AG AR AM AW AU AT AZ BS BH BD BB BY BE BZ BJ BM BT BO BQ BA BW BR IO BN BG BF BI CV KH CM CA KY CF TD CL CN CX CC CO KM CG CD CK CR CI HR CU CW CY CZ DK DJ DM DO EC EG SV GQ ER EE SZ ET FK FO FJ FI FR GF PF GA GM GE DE GH GI GR GL GD GP GU GT GG GN GW GY HT VA HN HK HU IS IN ID IR IQ IE IM IL IT JM JP JE JO KZ KE KI KP KR KW KG LA LV LB LS LR LY LI LT LU MO MG MW MY MV ML MT MH MQ MR MU YT MX FM MD MC MN ME MS MA MZ MM NA NR NP NL NC NZ NI NE NG NU NF MK MP NO OM PK PW PS PA PG PY PE PH PN PL PT PR QA RE RO RU RW BL SH KN LC MF PM VC WS SM ST SA SN RS SC SL SG SX SK SI SB SO ZA GS SS ES LK SD SR SJ SE CH SY TW TJ TZ TH TL TG TK TO TT TN TR TM TC TV UG UA AE GB US UM UY UZ VU VE VN VG VI WF EH YE ZM ZW'.split(' ');
  let names;
  try { const dn = new Intl.DisplayNames(['en-GB'], { type: 'region' }); names = Object.fromEntries(codes.map(c => [c, dn.of(c)])); }
  catch { names = Object.fromEntries(codes.map(c => [c, c])); }
  const countries = codes.map(c => ({ code: c, name: names[c] || c })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const popular = ['GB', 'US', 'CA', 'AU', 'NZ', 'IE', 'DE', 'FR', 'ES', 'IT', 'NL', 'CH'];

  // Map values saved by earlier versions of the app
  const legacyRegime = a => ({ 'UK CAA': 'uk', 'EASA member-state authority': 'easa', 'FAA': 'faa', 'Other / deciding': 'icao' })[a];
  const codeForName = n => { if (!n) return ''; const t = String(n).trim().toLowerCase(); const hit = countries.find(c => c.name.toLowerCase() === t || c.code.toLowerCase() === t); if (hit) return hit.code; if (/^(uk|united kingdom|england|scotland|wales|great britain)$/.test(t)) return 'GB'; if (/^(usa|united states|united states of america|us)$/.test(t)) return 'US'; return ''; };

  const licencesFor = r => [...(regimes[r] || regimes.icao).licences, ...common];
  const licence = (r, id) => licencesFor(r).find(l => l.id === id) || null;

  return { checked, regimes, countries, popular, regimeFor, authorityFor, legacyRegime, codeForName, licencesFor, licence, nameFor: c => names[c] || c };
})();
