import type { Category, Tier } from "./types";

// Rules first: most exchange filings announce their own type in the subject
// line, so a model call would be money spent on the obvious. Only filings the
// rules cannot place with confidence are sent to the cheap model, in one batch.

export interface Verdict {
  category: Category;
  tier: Tier;
  why: string;
  confident: boolean;
}

type Rule = [RegExp, (t: string) => Verdict | null];

const v = (category: Category, tier: Tier, why: string): Verdict => ({ category, tier, why, confident: true });

const KMP = /\b(ceo|cfo|chief executive|chief financial|managing director|whole.?time director|executive director|chairman|chairperson|key managerial)\b/;

const RULES: Rule[] = [
  // Paperwork that looks important but is not. Checked first so it cannot leak upward.
  [/newspaper|advertisement|publication of/, (t) =>
    v(/result/.test(t) ? "results" : "unclassified", 3, "Newspaper copy of something already filed")],
  [/esop|esos|esps|employee stock|stock option|allotment of .*shares? (under|pursuant to) /, () =>
    v("unclassified", 3, "Routine employee share allotment")],
  [/trading window/, () => v("unclassified", 3, "Routine trading-window notice")],
  [/\bcertificate\b|regulation 74|duplicate|loss of share|brsr|sustainability report|\besg\b|registrar|share transfer agent|investor grievance|reconciliation of share capital|statement of deviation|monitoring agency|reminder letter|dematerialis|\biepf\b|investor education/, () =>
    v("unclassified", 3, "Routine compliance paperwork")],

  // Auditor leaving is rare and a red flag; auditor being appointed is routine.
  [/auditor/, (t) =>
    /resign/.test(t)
      ? v("unclassified", 1, "An auditor resigning mid-term is a red flag worth reading")
      : v("unclassified", 3, "Routine auditor appointment")],

  [/pledg|encumbr|regulation 31/, () => v("pledging", 1, "Promoter pledge changes are a risk signal")],

  // Call logistics come before results: their text always mentions "financial results".
  [/transcript/, () => v("earnings_call", 3, "Transcript filed; FINN reads it into the Ledger instead")],
  [/earnings call|conference call|con.?call|audio recording|video recording|recording of|analysts? call|investor call/, () =>
    v("earnings_call", 3, "Call logistics or recording link")],
  [/analysts?.{0,3}institutional|institutional investor|analyst\(?s?\)? ?\/ ?investor|investors? meet|investor conference|schedule of .*meet|one.on.one/, () =>
    v("investor_meetings", 3, "Routine investor-meeting schedule")],

  // Results and everything that trails them.
  [/financial results?|unaudited|audited (standalone|consolidated|financial)|quarterly results?|results? for the (quarter|half|year|first|second|third|fourth)|result \/ financial/, (t) => {
    if (/intimation|notice of board|to consider|prior intimation/.test(t))
      return v("results", 3, "Only sets the date results will be considered");
    if (/reference to|issued by|results of (its|the) (subsidiary|parent|holding)/.test(t))
      return v("results", 2, "Results of a related company, not this one");
    if (/presentation/.test(t)) return v("results", 2, "Management's results deck");
    if (/press release|media release/.test(t)) return v("results", 2, "Management's own framing of the results");
    return v("results", 1, "Results filed: headline numbers read from the filing");
  }],
  [/investor presentation|corporate presentation|analyst presentation|results? presentation|earnings presentation/, () => v("results", 2, "Company presentation")],

  // People.
  [/resign|appoint|cessation|retire|change in (director|management|kmp|key managerial)|change in directorate|senior management|company secretary|compliance officer|demise/, (t) => {
    if (KMP.test(t)) return v("management_change", 1, "Change at the top of the company");
    if (/company secretary|compliance officer|senior management/.test(t))
      return v("management_change", 2, "Change below board level");
    return v("management_change", 2, "Board change; ranked up if it is a key executive");
  }],

  // Deals and capital.
  [/bagging|bags? |wins? |receipt of (an )?order|award.of.order|letter of (award|intent|acceptance)|work order|purchase order|contract/, () =>
    v("press_release", 2, "New business won")],
  [/incorporat\w* .{0,60}(subsidiary|company)|incorporation of|strike.?off|striking off|liquidation of .{0,40}subsidiary/, () =>
    v("M&A", 2, "Subsidiary housekeeping; small unless sized")],
  [/acqui|merger|amalgamation|demerger|scheme of arrangement|joint venture|slump sale|divest|disinvest|sale of (stake|shares|undertaking)|stake|term sheet|business transfer/, (t) =>
    /extension of (time|the time)/.test(t)
      ? v("M&A", 2, "Timeline change on a deal already announced")
      : v("M&A", 1, "Changes what the company owns")],
  [/wholly.owned subsidiary|subsidiary/, () => v("M&A", 2, "Subsidiary housekeeping; small unless sized")],
  [/qip|qualified institution|preferential|rights issue|buy.?back|fund.?rais|raising of funds|further public|warrants?|issue of securities/, (t) =>
    /intimation|reminder|notice/.test(t)
      ? v("fund_raise", 2, "A step in a fund raise already announced")
      : v("fund_raise", 1, "Changes the share count or the cash position")],
  [/commercial paper|non.?convertible|debenture|\bncds?\b|bonds?\b/, () =>
    v("fund_raise", 3, "Routine debt paper")],

  // Trouble.
  [/nclt|nclat|insolvency|\bcirp\b|court|tribunal|arbitration|show.?cause|litigation|lawsuit|search and seizure|raid|fraud|\bdefault|warning letter|sebi (order|notice|penalty|adjudicat|settlement|warning|interim)/, () =>
    v("litigation", 1, "Legal or regulatory action")],
  [/penalty|\bfines?\b|tax demand|demand order|\bgst\b|income.?tax|customs|assessment order|\border\b.*(authority|commissioner|department)/, () =>
    v("litigation", 2, "Tax or regulatory demand; usually contested and small")],

  [/insider|sast|regulation 7\(|regulation 29|takeover|promoter.*(acquisition|sale|disposal|purchase)|inter.se/, () =>
    v("insider_trading", 2, "A promoter or insider traded their own shares")],
  [/credit rating|ratings?\b/, (t) =>
    /downgrad|upgrad|revis|placed on|rating watch/.test(t) || (/outlook/.test(t) && !/reaffirm|re-affirm|stable/.test(t))
      ? v("credit_rating", 1, "The rating or its outlook moved")
      : v("credit_rating", 3, "Rating reaffirmed, nothing changed")],
  [/dividend/, () => v("dividend", 2, "Cash coming to shareholders; note the record date")],
  [/bonus|stock split|sub.?division/, () => v("bonus_split", 2, "Share count changes; price will adjust")],
  [/capex|capital expenditure|capacity|expansion|new plant|greenfield|brownfield|commission(ing|ed)|commencement of (commercial )?production/, () =>
    v("capex", 2, "Spending on new capacity")],
  [/postal ballot/, () => v("postal_ballot", 3, "Shareholder vote by post")],
  [/annual general|\bagm\b|\begm\b|extraordinary general|voting results?|scrutini[sz]er|book closure|annual report/, () =>
    v("agm_egm", 3, "Shareholder-meeting paperwork")],
  [/clarification|rumou?r|news item|media report/, () =>
    v("press_release", 2, "Company responding to a market rumour")],
  [/press release|media release|launch|partnership|collaborat|agreement|mou\b|memorandum of understanding/, (t) =>
    /performance for the (quarter|half|year)|quarter (and|&) (half|nine)|q[1-4] ?fy ?\d|financial performance/.test(t)
      ? v("results", 2, "Management's own framing of the results")
      : v("press_release", 2, "Company news")],
];

export function classify(headline: string, exchangeCategory: string, body: string): Verdict {
  // Every filing cites the SEBI listing regulations; strip that so "sebi" only matches real regulatory action.
  const t = `${headline} ${exchangeCategory} ${body.slice(0, 280)}`
    .toLowerCase()
    .replace(/securities and exchange board of india \(listing[^)]*\)[^.;]{0,40}?\d{4}/g, " ")
    .replace(/sebi \(listing[^)]*\)[^.;]{0,40}?\d{4}/g, " ")
    .replace(/(of |under )?sebi \(?lodr\)?( regulations?,? ?\d{0,4})?/g, " ")
    .replace(/sebi listing regulations?/g, " ");
  for (const [re, fn] of RULES) {
    if (re.test(t)) {
      const out = fn(t);
      if (out) return out;
    }
  }
  return {
    category: "unclassified",
    tier: 3,
    why: "No material type recognised",
    confident: false,
  };
}

export const CATEGORY_LABEL: Record<Category, string> = {
  results: "Results",
  "M&A": "M&A",
  fund_raise: "Fund raise",
  management_change: "Management change",
  litigation: "Legal and regulatory",
  insider_trading: "Insider trade",
  earnings_call: "Earnings call",
  investor_meetings: "Investor meetings",
  credit_rating: "Credit rating",
  dividend: "Dividend",
  bonus_split: "Bonus or split",
  capex: "Capex",
  press_release: "Company news",
  postal_ballot: "Postal ballot",
  agm_egm: "AGM or EGM",
  pledging: "Pledging",
  unclassified: "Routine",
};

export const ALL_CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];
