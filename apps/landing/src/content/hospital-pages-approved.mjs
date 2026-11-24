/**
 * Hospital ids approved for a page of their own at /find-care/hospitals/<id>/.
 * An entry gets a page only when it passes the rules in
 * src/lib/hospital-pages.mjs AND its id is listed here. Adding an id is a
 * reviewed decision. Removing one takes its page down on the next build.
 *
 * Seeded with the 40 entries that passed the rules on 24 November 2026.
 * Awaiting the owner's sign-off and the hospital data verification.
 */
export const APPROVED_IDS = [
  'ahpgic-cuttack',
  'aiims-bhopal',
  'aiims-bhubaneswar',
  'aiims-deoghar',
  'aiims-jodhpur',
  'aiims-nagpur',
  'aiims-new-delhi',
  'aiims-patna',
  'aiims-raipur',
  'aiims-rishikesh',
  'apollo-cancer-centre-chennai',
  'apollo-cancer-delhi',
  'basavatarakam-hyderabad',
  'bbci-guwahati',
  'blk-max-delhi',
  'breach-candy-hospital-cancer-mumbai',
  'cmc-vellore',
  'fortis-memorial-research-institute-gurugram',
  'hcg-cancer-centre-bangalore',
  'hcg-eko-kolkata',
  'hcg-panda-cuttack',
  'hcg-ranchi',
  'hn-reliance-mumbai',
  'hope-and-heal-jalpaiguri',
  'jaslok-hospital-cancer-mumbai',
  'jipmer-puducherry',
  'kgmu-lucknow',
  'lilavati-hospital-cancer-mumbai',
  'mahavir-cancer-sansthan-patna',
  'manipal-comprehensive-cancer-centre-manipal',
  'manipal-hospital-rangapani',
  'max-cancer-centre-saket-delhi',
  'medanta-cancer-institute-gurugram',
  'mnj-hyderabad',
  'nims-hyderabad',
  'pgimer-chandigarh',
  'rchrc-ranchi',
  'regional-cancer-centre-thiruvananthapuram',
  'rgci-delhi',
  'sir-ganga-ram-delhi',
];
