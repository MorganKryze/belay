// The 26 references verified on 2026-09-30 (docs/science.md lists them all). Rule: a DOI or a
// stable identifier read on an authoritative record. Unverified items are not here: Epley 1985
// (cited only as reproduced in Reynolds 2006), the 1.2–1.9 activity multipliers, the
// "82 % / 70 %" figures attributed to Frankenfield 2005, and a "1.25 kg chrome" plate colour.
export type IdentifierKind = "doi" | "pmid" | "isbn" | "dtic" | "report";
export type Identifier = { kind: IdentifierKind; value: string };
export type Source = {
  id: string;
  authors: readonly string[];
  year: number;
  title: string;
  venue: string;
  identifier: readonly Identifier[];
  url: string;
  verifiedOn: string;
  // True when the record that was read is a third-party copy, not the official host.
  readOnThirdPartyCopy?: boolean;
};

const VERIFIED_ON = "2026-09-30";
const doi = (value: string): Identifier => ({ kind: "doi", value });
const pmid = (value: string): Identifier => ({ kind: "pmid", value });

export const SOURCES = [
  {
    id: "brzycki-1993",
    authors: ["Brzycki M"],
    year: 1993,
    title: "Strength testing—predicting a one-rep max from reps-to-fatigue",
    venue: "Journal of Physical Education, Recreation & Dance. 1993;64(1):88–90",
    identifier: [doi("10.1080/07303084.1993.10606684")],
    url: "https://doi.org/10.1080/07303084.1993.10606684",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "reynolds-2006",
    authors: ["Reynolds JM", "Gordon TJ", "Robergs RA"],
    year: 2006,
    title:
      "Prediction of one repetition maximum strength from multiple repetition maximum testing and anthropometry",
    venue: "J Strength Cond Res. 2006;20(3):584–592",
    identifier: [doi("10.1519/R-15304.1"), pmid("16937972")],
    url: "https://pubmed.ncbi.nlm.nih.gov/16937972/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "lesuer-1997",
    authors: ["LeSuer DA", "McCormick JH", "Mayhew JL", "Wasserstein RL", "Arnold MD"],
    year: 1997,
    title:
      "The accuracy of prediction equations for estimating 1-RM performance in the bench press, squat, and deadlift",
    venue: "J Strength Cond Res. 1997;11(4):211–213",
    identifier: [doi("10.1519/00124278-199711000-00001")],
    url: "https://doi.org/10.1519/00124278-199711000-00001",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "mayhew-2008",
    authors: ["Mayhew JL", "Johnson BD", "LaMonte MJ", "Lauber D", "Kemmler W"],
    year: 2008,
    title:
      "Accuracy of prediction equations for determining one repetition maximum bench press in women before and after resistance training",
    venue: "J Strength Cond Res. 2008;22(5):1570–1577",
    identifier: [doi("10.1519/JSC.0b013e31817b02ad"), pmid("18714230")],
    url: "https://pubmed.ncbi.nlm.nih.gov/18714230/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "nuzzo-2024",
    authors: ["Nuzzo JL", "Pinto MD", "Nosaka K", "Steele J"],
    year: 2024,
    title:
      "Maximal number of repetitions at percentages of the one repetition maximum: a meta-regression and moderator analysis of sex, age, training status, and exercise",
    venue: "Sports Med. 2024;54(2):303–321",
    identifier: [doi("10.1007/s40279-023-01937-7"), pmid("37792272")],
    url: "https://doi.org/10.1007/s40279-023-01937-7",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "mifflin-1990",
    authors: ["Mifflin MD", "St Jeor ST", "Hill LA", "Scott BJ", "Daugherty SA", "Koh YO"],
    year: 1990,
    title: "A new predictive equation for resting energy expenditure in healthy individuals",
    venue: "Am J Clin Nutr. 1990;51(2):241–247",
    identifier: [doi("10.1093/ajcn/51.2.241"), pmid("2305711")],
    url: "https://pubmed.ncbi.nlm.nih.gov/2305711/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "frankenfield-2005",
    authors: ["Frankenfield D", "Roth-Yousey L", "Compher C"],
    year: 2005,
    title:
      "Comparison of predictive equations for resting metabolic rate in healthy nonobese and obese adults: a systematic review",
    venue: "J Am Diet Assoc. 2005;105(5):775–789",
    identifier: [doi("10.1016/j.jada.2005.02.005"), pmid("15883556")],
    url: "https://pubmed.ncbi.nlm.nih.gov/15883556/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "frankenfield-2003",
    authors: ["Frankenfield DC", "Rowe WA", "Smith JS", "Cooney RN"],
    year: 2003,
    title:
      "Validation of several established equations for resting metabolic rate in obese and nonobese people",
    venue: "J Am Diet Assoc. 2003;103(9):1152–1159",
    identifier: [doi("10.1016/S0002-8223(03)00982-9"), pmid("12963943")],
    url: "https://doi.org/10.1016/S0002-8223(03)00982-9",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "morton-2018",
    authors: [
      "Morton RW",
      "Murphy KT",
      "McKellar SR",
      "Schoenfeld BJ",
      "Henselmans M",
      "Helms E",
      "Aragon AA",
      "Devries MC",
      "Banfield L",
      "Krieger JW",
      "Phillips SM",
    ],
    year: 2018,
    title:
      "A systematic review, meta-analysis and meta-regression of the effect of protein supplementation on resistance training-induced gains in muscle mass and strength in healthy adults",
    venue: "Br J Sports Med. 2018;52(6):376–384",
    identifier: [doi("10.1136/bjsports-2017-097608"), pmid("28698222")],
    url: "https://pubmed.ncbi.nlm.nih.gov/28698222/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "jager-2017",
    authors: [
      "Jäger R",
      "Kerksick CM",
      "Campbell BI",
      "Cribb PJ",
      "Wells SD",
      "Skwiat TM",
      "Purpura M",
      "Ziegenfuss TN",
      "Ferrando AA",
      "Arent SM",
      "Smith-Ryan AE",
      "Stout JR",
      "Arciero PJ",
      "Ormsbee MJ",
      "Taylor LW",
      "Wilborn CD",
      "Kalman DS",
      "Kreider RB",
      "Willoughby DS",
      "Hoffman JR",
      "Krzykowski JL",
      "Antonio J",
    ],
    year: 2017,
    title: "International Society of Sports Nutrition Position Stand: protein and exercise",
    venue: "J Int Soc Sports Nutr. 2017;14:20",
    identifier: [doi("10.1186/s12970-017-0177-8"), pmid("28642676")],
    url: "https://pubmed.ncbi.nlm.nih.gov/28642676/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "helms-2014-ijsnem",
    authors: ["Helms ER", "Zinn C", "Rowlands DS", "Brown SR"],
    year: 2014,
    title:
      "A systematic review of dietary protein during caloric restriction in resistance trained lean athletes: a case for higher intakes",
    venue: "Int J Sport Nutr Exerc Metab. 2014;24(2):127–138",
    identifier: [doi("10.1123/ijsnem.2013-0054"), pmid("24092765")],
    url: "https://pubmed.ncbi.nlm.nih.gov/24092765/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "helms-2014-jissn",
    authors: ["Helms ER", "Aragon AA", "Fitschen PJ"],
    year: 2014,
    title:
      "Evidence-based recommendations for natural bodybuilding contest preparation: nutrition and supplementation",
    venue: "J Int Soc Sports Nutr. 2014;11:20",
    identifier: [doi("10.1186/1550-2783-11-20"), pmid("24864135")],
    url: "https://doi.org/10.1186/1550-2783-11-20",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "hodgdon-beckett-1984-men",
    authors: ["Hodgdon JA", "Beckett MB"],
    year: 1984,
    title: "Prediction of percent body fat for U.S. Navy men from body circumferences and height",
    venue: "Naval Health Research Center, San Diego. Report No. 84-11, 1984",
    identifier: [
      { kind: "report", value: "NHRC Report No. 84-11" },
      { kind: "dtic", value: "AD-A143890" },
      doi("10.21236/ada143890"),
    ],
    url: "https://doi.org/10.21236/ada143890",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "hodgdon-beckett-1984-women",
    authors: ["Hodgdon JA", "Beckett MB"],
    year: 1984,
    title: "Prediction of percent body fat for U.S. Navy women from body circumferences and height",
    venue: "Naval Health Research Center, San Diego. Report No. 84-29, 1984",
    identifier: [
      { kind: "report", value: "NHRC Report No. 84-29" },
      { kind: "dtic", value: "AD-A146456" },
      doi("10.21236/ada146456"),
    ],
    url: "https://doi.org/10.21236/ada146456",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "hodgdon-friedl-1999",
    authors: ["Hodgdon JA", "Friedl K"],
    year: 1999,
    title: "Development of the DoD Body Composition Estimation Equations",
    venue: "Naval Health Research Center Technical Document No. 99-2B, September 1999",
    identifier: [
      { kind: "report", value: "NHRC Technical Document No. 99-2B" },
      { kind: "dtic", value: "AD-A370158" },
      doi("10.21236/ada370158"),
    ],
    url: "https://doi.org/10.21236/ada370158",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "potter-2022",
    authors: ["Potter AW", "Tharion WJ", "Holden LD", "Pazmino A", "Looney DP", "Friedl KE"],
    year: 2022,
    title:
      "Circumference-based predictions of body fat revisited: preliminary results from a US Marine Corps body composition survey",
    venue: "Front Physiol. 2022;13:868627",
    identifier: [doi("10.3389/fphys.2022.868627"), pmid("35432005")],
    url: "https://doi.org/10.3389/fphys.2022.868627",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "gallagher-2000",
    authors: ["Gallagher D", "Heymsfield SB", "Heo M", "Jebb SA", "Murgatroyd PR", "Sakamoto Y"],
    year: 2000,
    title:
      "Healthy percentage body fat ranges: an approach for developing guidelines based on body mass index",
    venue: "Am J Clin Nutr. 2000;72(3):694–701",
    identifier: [doi("10.1093/ajcn/72.3.694"), pmid("10966886")],
    url: "https://pubmed.ncbi.nlm.nih.gov/10966886/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "garthe-2011",
    authors: ["Garthe I", "Raastad T", "Refsnes PE", "Koivisto A", "Sundgot-Borgen J"],
    year: 2011,
    title:
      "Effect of two different weight-loss rates on body composition and strength and power-related performance in elite athletes",
    venue: "Int J Sport Nutr Exerc Metab. 2011;21(2):97–104",
    identifier: [doi("10.1123/ijsnem.21.2.97"), pmid("21558571")],
    url: "https://pubmed.ncbi.nlm.nih.gov/21558571/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "hall-2011",
    authors: [
      "Hall KD",
      "Sacks G",
      "Chandramohan D",
      "Chow CC",
      "Wang YC",
      "Gortmaker SL",
      "Swinburn BA",
    ],
    year: 2011,
    title: "Quantification of the effect of energy imbalance on bodyweight",
    venue: "Lancet. 2011;378(9793):826–837",
    identifier: [doi("10.1016/S0140-6736(11)60812-X"), pmid("21872751")],
    url: "https://pubmed.ncbi.nlm.nih.gov/21872751/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "hall-2008",
    authors: ["Hall KD"],
    year: 2008,
    title: "What is the required energy deficit per unit weight loss?",
    venue: "Int J Obes. 2008;32(3):573–576",
    identifier: [doi("10.1038/sj.ijo.0803720"), pmid("17848938")],
    url: "https://doi.org/10.1038/sj.ijo.0803720",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "ribeiro-2020",
    authors: [
      "Ribeiro B",
      "Pereira A",
      "Neves PP",
      "Sousa AC",
      "Ferraz R",
      "Marques MC",
      "Marinho DA",
      "Neiva HP",
    ],
    year: 2020,
    title: "The role of specific warm-up during bench press and squat exercises: a novel approach",
    venue: "Int J Environ Res Public Health. 2020;17(18):6882",
    identifier: [doi("10.3390/ijerph17186882"), pmid("32971729")],
    url: "https://pubmed.ncbi.nlm.nih.gov/32971729/",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "ode-2007",
    authors: ["Ode JJ", "Pivarnik JM", "Reeves MJ", "Knous JL"],
    year: 2007,
    title: "Body mass index as a predictor of percent fat in college athletes and nonathletes",
    venue: "Med Sci Sports Exerc. 2007;39(3):403–409",
    identifier: [doi("10.1249/01.mss.0000247008.19127.3e"), pmid("17473765")],
    url: "https://doi.org/10.1249/01.mss.0000247008.19127.3e",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "fao-2004",
    authors: ["Joint FAO/WHO/UNU Expert Consultation"],
    year: 2004,
    title:
      "Human energy requirements. Report of a Joint FAO/WHO/UNU Expert Consultation, Rome, 17–24 October 2001",
    venue: "FAO Food and Nutrition Technical Report Series 1. Rome: FAO; 2004",
    identifier: [
      { kind: "isbn", value: "92-5-105212-3" },
      { kind: "report", value: "ISSN 1813-3932" },
    ],
    url: "https://www.fao.org/4/y5686e/y5686e00.htm",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "who-trs-894",
    authors: ["World Health Organization"],
    year: 2000,
    title: "Obesity: preventing and managing the global epidemic. Report of a WHO Consultation",
    venue: "WHO Technical Report Series 894. Geneva: WHO; 2000",
    identifier: [
      { kind: "isbn", value: "92 4 120894 5" },
      { kind: "report", value: "ISSN 0512-3054" },
      { kind: "report", value: "WHO IRIS handle 10665/42330" },
    ],
    url: "https://iris.who.int/handle/10665/42330",
    verifiedOn: VERIFIED_ON,
  },
  {
    id: "dodi-1308-3",
    authors: ["U.S. Department of Defense"],
    year: 2002,
    title: "DoD Physical Fitness and Body Fat Programs Procedures",
    venue: "DoD Instruction 1308.3, 5 November 2002",
    identifier: [{ kind: "report", value: "DoDI 1308.3, Enclosure 3, para E3.1.3" }],
    // The copy that was read: the official host blocked the verification tools.
    url: "https://det027inspectorgeneral.weebly.com/uploads/1/7/0/2/17029076/dodi1308.3_fitnessprogram_2002.pdf",
    verifiedOn: VERIFIED_ON,
    readOnThirdPartyCopy: true,
  },
  {
    id: "iwf-tcrr-2020",
    authors: ["International Weightlifting Federation"],
    year: 2020,
    title: "Technical and Competition Rules & Regulations 2020",
    venue: "IWF, in effect 1 January 2020",
    identifier: [{ kind: "report", value: "IWF TCRR 2020, rule 3.3.3.6" }],
    // The copy that was read: a Wayback snapshot, the IWF host blocked the verification tools.
    url: "https://web.archive.org/web/20250707232059if_/https://iwf.sport/wp-content/uploads/downloads/2020/01/IWF_TCRR_2020.pdf",
    verifiedOn: VERIFIED_ON,
  },
] as const satisfies readonly Source[];

export type SourceId = (typeof SOURCES)[number]["id"];

const BY_ID = new Map<string, Source>(SOURCES.map((s) => [s.id, s]));
export function sourceById(id: SourceId): Source {
  return BY_ID.get(id)!;
}
