/**
 * The ID-Ladder reference and demo data, with sources.
 *
 * This module is data only — it never touches the database. Two consumers use
 * it: `seed.ts` (destructive local reset) and `bootstrap.ts` (non-destructive
 * boot-time population in production).
 *
 * EVERY fee and waiver rule below carries an inline source URL. Figures that
 * could not be verified against a real source are NULL and marked UNVERIFIED
 * rather than guessed — a gap is preferable to a fabricated government fee.
 * All figures checked 2026-07-30.
 *
 * Jurisdictional constraint modelled throughout: a state's vital records
 * office only holds records for people born in that state, and a state's
 * waiver program generally reaches only its own records. An organization's
 * standing in one state therefore does not unlock another state's records.
 */

export const SEEDED_AT = "2026-07-30T00:00:00.000Z";

export type DocumentRow = {
  id: string;
  name: string;
  jurisdiction: string;
  fee_cents: number | null;
  waiver_available: 0 | 1;
  /** Issuing agency page the figure was read from — shown to users. */
  source_url: string;
  /** One plain-language line naming the fee and the statute behind any waiver. */
  source_note: string;
  /** Statute the waiver rests on, cited on the affidavit. Null when no waiver. */
  waiver_statute: string | null;
};

export const documents: DocumentRow[] = [
  // ---------------------------------------------------------------- FEDERAL
  {
    id: "us-ssn-card",
    name: "Social Security Card",
    jurisdiction: "US",
    // $0. SSA charges no fee for an original, replacement, or corrected card.
    // Source: https://oig.ssa.gov/scam-alerts/2026-03-10-ssa-provides-new-and-replacement-social-security-cards-for-free/
    fee_cents: 0,
    // Free for everyone, so there is no waiver to apply.
    waiver_available: 0,
    source_url:
      "https://oig.ssa.gov/scam-alerts/2026-03-10-ssa-provides-new-and-replacement-social-security-cards-for-free/",
    source_note:
      "Free. The Social Security Administration charges nothing for an original, replacement, or corrected card.",
    waiver_statute: null,
  },

  // ------------------------------------------------------------- CALIFORNIA
  {
    id: "ca-birth-certificate-state",
    name: "CA Certified Birth Record (State Registrar, VS 111)",
    jurisdiction: "CA",
    // $31.00 per copy, effective 2026-01-01 (a $2 increase under AB 64,
    // Chapter 662, Statutes of 2025). Note: CDPH has announced the fee drops
    // by $2 in 2027 when the Umbilical Cord Blood Collection Program fee ends.
    // Source: https://www.cdph.ca.gov/Programs/CHSI/Pages/Vital-Records-Fees.aspx
    fee_cents: 3100,
    // Waiver: Health & Safety Code 103577. AB 1733 (2014) created the
    // county-level waiver; AB 2490 (2018) extended the duty to the State
    // Registrar, capped at 3 free copies per year. See CA_BIRTH_RECORD_CONFLICT.
    // Source: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201720180AB2490
    waiver_available: 1,
    source_url:
      "https://www.cdph.ca.gov/Programs/CHSI/Pages/Vital-Records-Fees.aspx",
    source_note:
      "$31 per copy from the State Registrar, effective 1 January 2026 under AB 64. The fee is waived for people experiencing homelessness under California AB 1733 / AB 2490 (Health & Safety Code 103577), which covers up to three copies a year.",
    waiver_statute:
      "California Health & Safety Code section 103577, added by AB 1733 (2014) and extended to the State Registrar by AB 2490 (2018)",
  },
  {
    id: "ca-birth-certificate-county",
    name: "CA Certified Birth Record (County Recorder / Local Registrar)",
    jurisdiction: "CA",
    // $31.00 per copy. Same statutory fee — HSC 103625(f) — as the state copy;
    // CDPH's 2026 fee schedule letter is addressed to local registrars, county
    // clerks, and county recorders, who remit the state portion via VS-5.
    // Source: https://www.cdph.ca.gov/Programs/RPHO/Pages/All-Local-Health-Jurisdiction-Letters-Notices/25-05_2026-Fee-Schedule_11-03-2025.aspx
    fee_cents: 3100,
    // Waiver: HSC 103577 — "each local registrar or county recorder shall,
    // without a fee, issue a certified record of live birth" to a person who
    // verifies homeless status. Applicant must apply to the county of birth.
    // Source: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201320140AB1733
    waiver_available: 1,
    source_url:
      "https://www.cdph.ca.gov/Programs/RPHO/Pages/All-Local-Health-Jurisdiction-Letters-Notices/25-05_2026-Fee-Schedule_11-03-2025.aspx",
    source_note:
      "$31 per copy, the same statutory fee as the state copy. Waived under California AB 1733 (Health & Safety Code 103577); the request goes to the county where the birth happened.",
    waiver_statute:
      "California Health & Safety Code section 103577, added by AB 1733 (2014)",
  },
  {
    id: "ca-id-card",
    name: "CA Identification Card (DMV)",
    jurisdiction: "CA",
    // $40.00 for a regular ID card.
    // Source: https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/
    fee_cents: 4000,
    // Waiver: No-Fee ID card for people who are homeless under the
    // McKinney-Vento definition, verified on form DL 933 by a government
    // public social service agency or an IRS 501(c)(3) nonprofit serving
    // low-income/unhoused people. DL 933 expires 90 days after issuance.
    // Source: https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/reduced-no-fee-id-card-program-information-for-organizations/
    waiver_available: 1,
    source_url:
      "https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/",
    source_note:
      "$40 for a regular ID card. The DMV issues it free to people experiencing homelessness when a government agency or a 501(c)(3) signs form DL 933, which is valid for 90 days.",
    waiver_statute:
      "California Vehicle Code section 14902 and the Department of Motor Vehicles No-Fee Identification Card programme (form DL 933)",
  },
  {
    id: "ca-reduced-fee-id-card",
    name: "CA Reduced-Fee Identification Card (DMV)",
    jurisdiction: "CA",
    // $11.00 for qualifying low-income applicants (form DL 937).
    // Source: https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/
    fee_cents: 1100,
    // This IS the reduced-fee program; the separate no-fee path is ca-id-card.
    waiver_available: 0,
    source_url:
      "https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/licensing-fees/",
    source_note:
      "$11 for applicants who qualify on income and submit form DL 937. This is the reduced-fee programme, separate from the no-fee card.",
    waiver_statute: null,
  },
  {
    id: "ca-proof-of-residency",
    name: "CA Proof of Residency (two documents)",
    jurisdiction: "CA",
    // $0 — evidentiary documents (utility bill, lease, etc.), not a record
    // issued for a fee. DMV requires two for a first-time REAL ID.
    // Source: https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/identification-id-cards/
    fee_cents: 0,
    waiver_available: 0,
    source_url:
      "https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/identification-id-cards/",
    source_note:
      "No fee. The DMV asks for two documents showing a California address for a first-time REAL ID.",
    waiver_statute: null,
  },

  // --------------------------------------------------------------- MICHIGAN
  {
    id: "mi-birth-certificate-state",
    name: "MI Certified Birth Record (MDHHS Vital Records)",
    jurisdiction: "MI",
    // $34.00 for the first certified copy ($16.00 each additional).
    // NOTE: michigan.gov blocks automated fetches, so this figure comes from
    // the state's own contracted vendor plus a corroborating secondary source
    // rather than a direct read of the MDHHS fee page.
    // Sources: https://www.michigan.gov/mdhhs/doing-business/vitalrecords/additonal-information/fees_1
    //          https://www.vitalchek.com/v/birth-certificates/michigan/michigan-vital-records
    fee_cents: 3400,
    // Waiver: HB 4853 (Brann), signed 2019 and implemented early 2020, lets a
    // Category 1 homeless individual BORN IN MICHIGAN apply to MDHHS Vital
    // Records for a fee waiver and receive the record at no cost.
    // Source: http://www.miboscoc.com/uploads/2/5/7/2/25729897/homeless_vital_documents_-_final.pdf
    waiver_available: 1,
    source_url:
      "https://www.michigan.gov/mdhhs/doing-business/vitalrecords/additonal-information/fees_1",
    source_note:
      "$34 for the first certified copy from MDHHS. Waived under Michigan HB 4853 (2019) for Category 1 homeless applicants born in Michigan, on a verification letter from a public service agency.",
    waiver_statute:
      "Michigan HB 4853 (2019), amending the Public Health Code, Act 368 of 1978",
  },
  {
    id: "mi-birth-certificate-county",
    name: "MI Certified Birth Record (County Clerk)",
    jurisdiction: "MI",
    // UNVERIFIED. There is no single statewide county fee: MDHHS's own
    // provider training states "Fees range from $5 to $34 for each Birth
    // Certificate" and that "Process may look different at each local Clerk's
    // office." Left NULL rather than picking a number from that range.
    // Source: http://www.miboscoc.com/uploads/2/5/7/2/25729897/homeless_vital_documents_-_final.pdf
    fee_cents: null,
    // Not a fee waiver but a reimbursement: the provider pays the clerk, then
    // claims it back on form MDHHS-5832 from a capped ($90,000/yr under PA 67
    // of 2019, Sec. 456) pool. Applicant must apply to the county of birth.
    // Source: http://www.miboscoc.com/uploads/2/5/7/2/25729897/homeless_vital_documents_-_final.pdf
    waiver_available: 1,
    source_url:
      "http://www.miboscoc.com/uploads/2/5/7/2/25729897/homeless_vital_documents_-_final.pdf",
    source_note:
      "There is no statewide fee for a county copy — clerks charge roughly $5 to $34 and each office runs its own process. Providers pay the clerk and reclaim the cost on form MDHHS-5832.",
    waiver_statute:
      "Michigan HB 4853 (2019); county copies are reimbursed under PA 67 of 2019, section 456",
  },
  {
    id: "mi-id-card",
    name: "MI State Identification Card (Secretary of State)",
    jurisdiction: "MI",
    // $10.00 standard fee.
    // Source: https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card
    fee_cents: 1000,
    // Waiver: no-fee state ID for people experiencing homelessness, added by
    // Sen. O'Brien to the veterans' free-ID bill (SB 404, 2017) and
    // implemented by SOS in April 2018. Requires a Homeless Verification
    // Letter from a public service agency plus an HMIS photo ID.
    // Source: https://www.mihomeless.org/vital-documents/
    waiver_available: 1,
    source_url:
      "https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card",
    source_note:
      "$10 standard fee. The Secretary of State issues it free to people experiencing homelessness on a Homeless Verification Letter from a public service agency plus an HMIS card.",
    waiver_statute:
      "Michigan SB 404 (2017), implemented by the Secretary of State in April 2018",
  },
  {
    id: "mi-proof-of-residency",
    name: "MI Proof of Residency (two documents)",
    jurisdiction: "MI",
    // $0 — evidentiary documents. SOS requires two documents showing name and
    // Michigan physical address, dated within the last 90 days.
    // Source: https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card
    fee_cents: 0,
    waiver_available: 0,
    source_url:
      "https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card",
    source_note:
      "No fee. The Secretary of State asks for two documents showing a Michigan address, dated within the last 90 days.",
    waiver_statute: null,
  },

  // ------------------------------------------------------------- WASHINGTON
  {
    id: "wa-birth-certificate",
    name: "WA Certified Birth Record (DOH Center for Health Statistics)",
    jurisdiction: "WA",
    // $25.00 per certified or informational copy ("fees start at $25";
    // ordering and shipping method can add more).
    // Source: https://doh.wa.gov/licenses-permits-and-certificates/vital-records/ordering-vital-record/birth-record
    fee_cents: 2500,
    // Waiver: RCW 70.58A.560 — "The department may not charge a fee for
    // issuing a birth certification for homeless persons as defined in RCW
    // 43.185C.010 living in state." DOH is explicit about the jurisdictional
    // limit: "We can only provide certificates for persons born and currently
    // living in Washington state."
    // Sources: https://app.leg.wa.gov/RCW/default.aspx?cite=70.58A.560
    //          https://doh.wa.gov/licenses-permits-and-certificates/vital-records/vital-records-no-fee-specific-circumstances
    waiver_available: 1,
    source_url:
      "https://doh.wa.gov/licenses-permits-and-certificates/vital-records/ordering-vital-record/birth-record",
    source_note:
      "$25 per copy. Washington RCW 70.58A.560 bars the department from charging homeless residents, but a government agency or homeless service provider has to submit the request on letterhead, and it covers only people born and living in Washington.",
    waiver_statute:
      "Washington RCW 70.58A.560, applying the definition of homelessness in RCW 43.185C.010",
  },
  {
    id: "wa-id-card",
    name: "WA Identicard, 6-year (Department of Licensing)",
    jurisdiction: "WA",
    // $61.00 for six years ($81.00 for eight).
    // Source: https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees
    fee_cents: 6100,
    // Waiver: RCW 46.20.195 (SB 5815, 2022; effective 2023-01-01) — a
    // one-time free identicard for homeless individuals meeting the RCW
    // 43.185C.010 definition who are expected to reside in Washington.
    // NOTE: unlike CA and MI, this statute does NOT require a provider
    // attestation. See ATTESTATION_MODEL note below.
    // Source: https://app.leg.wa.gov/RCW/default.aspx?cite=46.20.195
    waiver_available: 1,
    source_url:
      "https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees",
    source_note:
      "$61 for a six-year card, $81 for eight. Washington RCW 46.20.195 gives one free identicard to a homeless resident — notably without requiring a provider to sign.",
    waiver_statute:
      "Washington RCW 46.20.195, enacted by SB 5815 (2022)",
  },
  {
    id: "wa-reduced-fee-id-card",
    name: "WA Reduced-Fee Identicard (Department of Licensing)",
    jurisdiction: "WA",
    // $5.00 at-cost card for qualifying applicants (DSHS public assistance,
    // WIC, certain facility discharges, or applicants under 25).
    // Source: https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees
    fee_cents: 500,
    waiver_available: 0,
    source_url:
      "https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees",
    source_note:
      "$5 at-cost card for applicants on state assistance, on WIC, leaving certain facilities, or under 25.",
    waiver_statute: null,
  },
  {
    id: "wa-proof-of-residency",
    name: "WA Proof of Washington Residency",
    jurisdiction: "WA",
    // $0 — evidentiary documents, not a record issued for a fee.
    // Source: https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees
    fee_cents: 0,
    waiver_available: 0,
    source_url:
      "https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees",
    source_note:
      "No fee. Evidentiary documents, not a record the state issues.",
    waiver_statute: null,
  },
];

/**
 * CA_BIRTH_RECORD_CONFLICT — resolved.
 *
 * Sources disagree because the law changed and the older ones were never
 * updated. AB 1733 (2014, operative 2015-07-01) added Health & Safety Code
 * 103577 and reached only the county: "each local registrar or county
 * recorder shall, without a fee, issue a certified record of live birth."
 * The State Registrar had no such duty, which is why provider guides written
 * between 2015 and 2018 say county-only.
 *
 * AB 2490 (2018, approved 2018-09-19, effective 2019-01-01) amended 103577 to
 * add the State Registrar, who "shall provide up to three copies per year of
 * a certified record" without fee, and "may provide additional copies at his
 * or her discretion."
 *
 * CURRENT ANSWER: both. A fee-exempt California birth record may be requested
 * from the county of birth (local registrar or county recorder, unlimited) OR
 * from the State Registrar (capped at 3 free copies per year). Guidance
 * asserting county-only is pre-2019 and stale.
 *
 * Sources: https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201720180AB2490
 *          https://leginfo.legislature.ca.gov/faces/billNavClient.xhtml?bill_id=201320140AB1733
 *
 * ATTESTATION_MODEL — who must attest, per jurisdiction.
 *
 * CA birth record: a CDPH affidavit that "shall not be deemed complete unless
 *   it is signed by BOTH the person making a request ... and a homeless
 *   services provider that has knowledge of the applicant's housing status."
 *   The provider may not charge for the verification. HSC 103577 defines
 *   "homeless services provider" broadly: governmental/nonprofit agencies,
 *   licensed attorneys, school liaisons, state-funded human services
 *   providers, and law-enforcement-designated liaisons.
 * CA ID card: form DL 933, issued by a government public social service
 *   agency or a 501(c)(3) serving low-income/unhoused people; valid 90 days.
 * MI birth record: DCH-VR Homeless Verification Letter on agency letterhead.
 *   For the county-reimbursement path the agency must additionally hold a
 *   Sigma Vendor ID and have HMIS access to verify Category 1 homelessness.
 * MI ID card: Homeless Verification Letter from a public service agency plus
 *   an HMIS photo ID.
 * WA birth record: request submitted by "a government agency or homeless
 *   service provider working on behalf of the homeless individual" on
 *   official letterhead.
 * WA ID card: NO provider attestation required by statute — RCW 46.20.195
 *   turns on meeting the RCW 43.185C.010 definition, and DOL lets applicants
 *   under 25 with no permanent address attest at the counter. This is the one
 *   researched case that breaks the "a provider must always sign" pattern.
 */

export type PrerequisiteRow = {
  document_id: string;
  requires_document_id: string;
  attestable: 0 | 1;
};

export const prerequisites: PrerequisiteRow[] = [
  // CA ID card: proof of identity/legal presence, SSN, and two residency docs.
  // Source: https://www.dmv.ca.gov/portal/driver-licenses-identification-cards/identification-id-cards/
  { document_id: "ca-id-card", requires_document_id: "ca-birth-certificate-state", attestable: 0 },
  { document_id: "ca-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  // Residency is the one a provider can vouch for on a client's behalf.
  { document_id: "ca-id-card", requires_document_id: "ca-proof-of-residency", attestable: 1 },

  { document_id: "ca-reduced-fee-id-card", requires_document_id: "ca-birth-certificate-state", attestable: 0 },
  { document_id: "ca-reduced-fee-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  { document_id: "ca-reduced-fee-id-card", requires_document_id: "ca-proof-of-residency", attestable: 1 },

  // MI ID card: identity + legal presence, SSN, two Michigan residency docs.
  // Source: https://michiganlegalhelp.org/resources/ids-and-name-change/getting-michigan-id-card
  { document_id: "mi-id-card", requires_document_id: "mi-birth-certificate-state", attestable: 0 },
  { document_id: "mi-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  { document_id: "mi-id-card", requires_document_id: "mi-proof-of-residency", attestable: 1 },

  // WA identicard.
  // Source: https://dol.wa.gov/driver-licenses-and-permits/driver-licensing-fees
  { document_id: "wa-id-card", requires_document_id: "wa-birth-certificate", attestable: 0 },
  { document_id: "wa-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  { document_id: "wa-id-card", requires_document_id: "wa-proof-of-residency", attestable: 1 },

  { document_id: "wa-reduced-fee-id-card", requires_document_id: "wa-birth-certificate", attestable: 0 },
  { document_id: "wa-reduced-fee-id-card", requires_document_id: "us-ssn-card", attestable: 0 },
  { document_id: "wa-reduced-fee-id-card", requires_document_id: "wa-proof-of-residency", attestable: 1 },
];

export const organizations = [
  {
    id: "org-ca-demo",
    auth0_org_id: "org_demo_california",
    name: "Bay Area Housing Collective",
    standing_jurisdictions: JSON.stringify(["CA"]),
  },
  {
    id: "org-mi-demo",
    auth0_org_id: "org_demo_michigan",
    name: "Detroit Homeless Outreach Network",
    standing_jurisdictions: JSON.stringify(["MI"]),
  },
];

export const cases = [
  {
    // Happy path: everything the client needs sits inside one state, and the
    // organization has standing there.
    id: "case-ca-native",
    organization_id: "org-ca-demo",
    client_ref: "CLIENT-0001",
    birth_jurisdiction: "CA",
    current_jurisdiction: "CA",
    goal_document_id: "ca-id-card",
    created_at: SEEDED_AT,
  },
  {
    // The interesting one. The client needs a CA ID, which requires a birth
    // record only Michigan holds. The org's California standing does not let
    // it attest for a Michigan-held record, and Michigan's waiver reaches only
    // Michigan-born applicants — so this case needs an org with MI standing.
    id: "case-mi-born-in-ca",
    organization_id: "org-ca-demo",
    client_ref: "CLIENT-0002",
    birth_jurisdiction: "MI",
    current_jurisdiction: "CA",
    goal_document_id: "ca-id-card",
    created_at: SEEDED_AT,
  },
];

// Both demo clients start holding nothing — that is the point of the demo.
export const caseHoldings: { case_id: string; document_id: string }[] = [];

