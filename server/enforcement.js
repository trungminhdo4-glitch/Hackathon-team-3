import { isOversightPublisher } from './procurementSources.js';

const sentences = new Intl.Segmenter('en', {granularity:'sentence'});
const clean = text => text.replace(/\s+/gu, ' ').trim();
const escape = name => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const suffix = '(?:incorporated|inc|corp(?:oration)?|ltd|limited|llc|plc|gmbh|s\\.?a\\.?)';
const notCaseRecord = /\b(?:public (?:comment|consultation)|stakeholder submission|consultation response|petition submitted by|complaint submitted by|(?:draft|proposed) (?:decision|order|settlement)|annual (?:report|catalogue|catalog)|(?:index|list|register) of (?:decisions|sanctions))\b/i;
const preliminary = /\b(?:alleg\w*|propos\w*|hypothetical|might|could|would|may have|if approved|plan(?:s|ned)? to|consider(?:s|ed|ing) (?:a |an? )?(?:fine|sanction)|sought|seeks? to|called on|urged|claims? that|denied that|false that|untrue|never|did not (?:fine|impose|order)|no (?:fine|penalty|violations?)|(?:found|was) not (?:in breach|in violation|unlawful))\b/i;
const authority = /\b(?:authorit(?:y|ies)|commission(?:er)?|regulator|court|tribunal|committee|agency|attorney general|dpa|sa|ap|cnil|ftc|ico|sec)\b/i;
const protectedData = /\b(?:biometric(?:s| data| information)?|facial[- ]recognition|photos of faces|personal (?:data|information)|sensitive (?:data|information)|location data|browsing (?:history|data)|health (?:records|data)|privacy rights?|data protection)\b/i;
const finding = /\b(?:unlawful\w*|illegal(?:ly)?|without (?:a |any |the (?:required )?)?(?:lawful|legal) (?:basis|grounds?)|without (?:valid |informed |the (?:required )?)?consent|violat\w*|infring\w*|contrary to|in breach of)\b/i;
const conduct = /\b(?:process\w*|collect\w*|builds?|built|use[ds]?|using|disclos\w*|sell(?:s|ing)?|sold|shar(?:e[ds]?|ing)|transfer\w*|retain\w*|retention|delet\w*|eras\w*|scrap(?:e[ds]?|ing)|stor(?:e[ds]?|ing)|protect\w*|expos\w*)\b/i;
const ban = /\b(?:stop|cease|bar(?:s|red)?|prohibit\w*|bann?ed|must not|may not)\b/i;
const setAside = /\b(?:overturned|quashed|vacated|annulled|rescinded|set aside|withdrawn|reversed|repealed|lifted)\b/i;
const unresolved = /\b(?:suspended|stayed|no longer (?:effective|in (?:force|effect)|applies)|pending (?:an? |judicial )?(?:appeal|review)|under appeal|lodged an appeal|appealed (?:the |this |that |against )?(?:fine|order|decision|penalty))\b/i;
const effective = /\b(?:remains? (?:in (?:force|effect)|effective|enforceable|binding|operative)|(?:appeal|review) does not (?:automatically )?(?:suspend|stay) (?:the |this )?(?:order|decision|penalty|fine)|(?:court|tribunal) (?:upheld|affirmed) (?:the |this )?(?:order|decision|penalty|fine))\b/i;
const dispositionDate = /\bdate of (?:the )?(?:final )?(?:decision|order)\s*:\s*(?:\d{1,2}\s+\p{L}+\s+\d{4}|\p{L}+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/iu;

export function isEnforcementSource(doc) {
  if (!isOversightPublisher(doc.url)) return false;
  return !notCaseRecord.test(doc.title) &&
    !/\/(?:public[-_]?comments?|consultation[-_]?responses?|stakeholder[-_]?submissions?)(?:[/-]|$)/i.test(new URL(doc.url).pathname);
}

function statements(doc) {
  const values = doc.text.split(/\n+/u).flatMap(line => [...sentences.segment(line)].map(s => clean(s.segment)));
  return [...new Set(values)].filter(line => line.length >= 12 && line.length <= 1200 && !line.endsWith('?'));
}

function named(names) {
  return '(?<![\\p{L}\\p{N}_.-])(?:' + names.map(escape).sort((a,b) => b.length-a.length).join('|') + ')(?![\\p{L}\\p{N}_-])';
}

function patterns(names) {
  const target = named(names);
  // Do not turn a product or an operator prefix into the respondent (e.g. "Lens Plus").
  const respondent = target + '(?:[, ]+\\s*' + suffix + '\\.?)?' +
    '(?=$|[,.():;”“"’\\d€$£]|\\s+(?:for|to|from|on|over|because|after|in|following|a total|a sum|EUR|USD|GBP|[€$£\\d]))';
  const direct = '(?:(?:fined|fines|sanctioned|sanctions|ordered|orders|banned|bans|barred|bars|prohibited|prohibits)|decided to (?:fine|sanction|order|ban))\\s+';
  const imposed = '(?:impos(?:es|ed)|issu(?:es|ed)|lev(?:ied|ies))\\s+(?:an?|the)\\s+(?:administrative |civil |monetary |binding |final )*(?:fine|penalty|sanction|order|ban)' +
    '(?:(?!\\s(?:on|against)\\s)[^!?;]){0,175}?\\s+(?:on|against)\\s+';
  return {
    name:new RegExp(target,'iu'),
    sanction:new RegExp('\\b(?:' + direct + '|' + imposed + ')(?:(?:the )?company )?' + respondent +
      '|' + target + '(?:[, ]+\\s*' + suffix + '\\.?)?\\s+(?:(?:has|had) been|was|is)\\s+(?:fined|sanctioned|ordered|banned|prohibited)\\b','iu'),
    actor:new RegExp(target + '\\s+(?:(?:has|had|was|is|illegally|unlawfully)\\s+){0,2}(?:process|collect|use|built|build|sold|sell|shar|disclos|transfer|retain|expos|violat|infring|scrap)\\w*\\b','iu'),
  };
}

function shortForms(action, names) {
  // An issuer can explicitly define the respondent's shorthand even when the
  // marketing site does not. Its validity is confined to this one decision.
  const definition = new RegExp(named(names) + '(?:[, ]+\\s*' + suffix + '\\.?)?\\s*\\((?:hereinafter|referred to as)\\s*[: ,]?\\s*["“]?([\\p{L}][\\p{L}\\p{N} -]{1,55}?)["”]?\\)','giu');
  return [...action.matchAll(definition)].map(match => match[1].trim()).filter(label =>
    !/^(?:the )?(?:respondent|company|defendant|operator|controller|applicant|service|it)$/i.test(label));
}

function qualifies(action, doc) {
  return !preliminary.test(action) && !/\b(?:requested|recommended|demanded)\b.{0,100}\b(?:fine[ds]?|penalty|sanction)\b/i.test(action) &&
    (authority.test(action) || authority.test(doc.title) || /\b(?:decision|final order|enforcement)\b/i.test(doc.title));
}

function materialPractice(line) {
  return !preliminary.test(line) && protectedData.test(line) && conduct.test(line) && (finding.test(line) || ban.test(line));
}

// The fine must concern this service's operation. Corporate HR, marketing
// analytics and newsletter subscriptions can each involve the same legal entity.
const operatingTopics = [
  /\b(?:biometrics?|facial[- ]recognition|face[- ]matching|fingerprints?|photos of faces)\b/i,
  /\b(?:geolocation|location tracking|location data)\b/i,
  /\b(?:browser extensions?|browsing (?:history|data|activity))\b/i,
  /\b(?:patient|medical|healthcare|health records?)\b/i,
  /\b(?:credit scor\w*|consumer credit|creditworthiness)\b/i,
  /\b(?:law[- ]enforcement|police investigations?)\b/i,
];
const peripheral = /\b(?:employee payroll|payroll|recruitment|job applicants?|newsletter|marketing (?:emails?|website)|mailing list|website cookies|(?:own|internal) (?:office access|staff attendance|employees?|building access))\b/ig;
const incidentalRole = /\b(?:victim|complainant|whistleblower|reported that|notified .{1,40} that|reporting (?:that|an? |its )|on behalf of)\b/i;
const actorAction = /^(?:(?:its|the|unlawful(?:ly)?|illegal(?:ly)?|unconsented|systematic|continued|data)\s+){0,4}(?:process|collect|shar|disclos|transfer|use|us(?:e|ing)|sale|sell|stor|retention|retain|target|scrap|expos|operat|violat|infring|fail(?:ed|ure|ing) to protect)\w*\b/i;
const fineAmount = /\b(?:fine|penalty)\s+(?:of|amounting to|in the amount of)\s+(?:[€£$]|(?:EUR|GBP|USD)\s*)?\s*\d[\d,. ]*(?:\s*(?:million|billion|thousand))?/i;
const differentMatter = /\b(?:(?:a |an )?(?:separate|different|unrelated|previous|earlier) (?:matter|case|proceeding|incident|fine)|in another case|previously fined|only if|unless|if .{0,50}\bfails? to)\b/i;
const geographicScope = /\b(?:territor(?:y|ies)|located in|residing in|residents?|including (?:those |of |people )?\w+ (?:people|individuals)|within the jurisdiction of)\b/i;

function sameIssuer(left,right) {
  const labels = text => text.match(/\b(?:[A-Z][\p{L}-]+\s+(?:DPA|SA|Supervisory Authority|Data Protection Authority|Privacy Commissioner)|FTC|CNIL|ICO)\b/gu) || [];
  const issuer = labels(left);
  return labels(right).some(label => issuer.includes(label));
}

function statedReason(tail) {
  return tail.match(/\b(?:for|because of|over|in connection with)\s+(.+)/iu)?.[1].replace(/[.!]\s*$/u,'');
}

function headlineAlias(action,title,reason,names) {
  if (!reason || !sameIssuer(action,title) || !title.toLowerCase().includes(reason.toLowerCase())) return [];
  // The same issuer must repeat the same reason in its headline and full-name
  // disposition. A shared first word elsewhere on the page cannot link parties.
  const abbreviated = names.filter(name => name.includes(' ')).map(name => name.split(' ').slice(0,-1).join(' '));
  return abbreviated.filter(short => short.length >= 4 && patterns([short]).sanction.test(title));
}

function affectsService(practice,description,actor) {
  const internal = [...practice.matchAll(peripheral)].map(m => m[0].toLowerCase());
  if (internal.some(term => !description.toLowerCase().includes(term)) || incidentalRole.test(practice)) return false;
  if (operatingTopics.some(topic => topic.test(practice) && topic.test(description))) return true;
  // A named product reference has to be part of the affected tool or use,
  // not just the regulator's addressee in the header of a document.
  const sameService = new RegExp('(?:for (?:the purpose of )?|through |via |using |in |operat(?:es|ing) )(?:their |its |the |an? )?' +
    "['“\"‘]?" + actor + '(?:(?!\\b(?:other|separate|another)\\b)[^.!?;]){0,70}\\b(?:service|software|system|platform|application)\\b','iu');
  if (sameService.test(practice)) return true;
  // Product-specific operational terminology outside the common data/justice
  // vocabulary, e.g. a decision about the publisher's messaging or recognition service.
  const use = practice.match(/\b(?:its|their|the)\s+([\p{L}-]{5,})\s+(?:service|platform|system|software|application)\b/iu)?.[1];
  return !!use && !/^(?:online|digital|software|mobile|commercial|public|private|internet|other)$/i.test(use) &&
    new RegExp('\\b' + escape(use) + '\\b','iu').test(description);
}

function disposition(line) {
  if (!/\b(?:fine|order|decision|ruling|sanction|penalty|enforcement|appeal)\b/i.test(line)) return null;
  if (effective.test(line) && !/\b(?:whether|disputes? that|claims? that|denied that)\b/i.test(line)) return 'operative';
  if (/\b(?:refus(?:ed|es)|declin(?:ed|es)|failed|unable) to (?:overturn|quash|vacate|appeal|suspend|reverse)|\b(?:not|never) (?:been )?(?:overturned|quashed|vacated|suspended|stayed|reversed)|\b(?:dismissed|rejected) (?:the |its )?appeal\b/i.test(line)) return null;
  if (setAside.test(line)) return 'set_aside';
  return unresolved.test(line) ? 'uncertain' : null;
}

const recordUrl = value => {
  try { const url = new URL(value); return url.origin + url.pathname.replace(/\/$/u,''); } catch { return ''; }
};

function sameDecision(first, second) {
  if (first.id === second.id || recordUrl(first.url) === recordUrl(second.url)) return true;
  if ((second.links || []).some(link => recordUrl(link) === recordUrl(first.url))) return true;
  const caseIds = text => text.match(/\b[A-Z]{2,8}[-/]\d{2,4}[-/]\d{1,7}\b/g) || [];
  const ids = caseIds(first.text);
  return caseIds(second.text).some(id => ids.includes(id));
}

function statusUpdate(record, records, names) {
  let pending;
  for (const other of records) {
    if (!sameDecision(record.doc,other.doc)) continue;
    for (const quote of other.lines) {
      const status = disposition(quote);
      if (!status) continue;
      const respondent = quote.match(/\b(?:fine|order|judgment|ruling|decision|sanction|penalty)\s+(?:against|on|concerning)\s+(.+)/i)?.[1];
      if (respondent && respondent.search(names) !== 0) continue;
      const scoped = names.test(quote) || names.test(other.doc.title) ||
        other.doc.id === record.doc.id && /\b(?:this|that|the) (?:decision|order|fine|sanction)\b/i.test(quote);
      if (!scoped) continue;
      const update = {doc:other.doc,quote,status};
      if (status === 'set_aside') return update;
      if (!pending || status === 'operative') pending = update;
    }
  }
  return pending;
}

export function changedEnforcementStatus(doc, context) {
  const names = [context.productName,...context.aliases,context.vendor].filter(Boolean);
  if (!names.length) return false;
  const candidates = [...context.documents.values()].filter(other => isEnforcementSource(other) && sameDecision(doc,other));
  const update = statusUpdate({doc},candidates.map(doc => ({doc,lines:statements(doc)})),patterns(names).name);
  return !!update && update.status !== 'operative';
}

/** Reconstruct only what the published record establishes: who was sanctioned,
 * what product practice was adjudicated, and the actual scope in those passages. */
export function enforcementRecord(context) {
  const products = [context.productName,...context.aliases].filter(Boolean);
  if (!products.length) return null;
  const product = patterns(products);
  const identityPages = context.siteIdentity ? [...context.vendorDocs,context.siteIdentity] : context.vendorDocs;
  const firstParty = identityPages.flatMap(doc => {
    const namedPage = product.name.test(doc.title);
    return statements(doc).filter(line => (namedPage || product.name.test(line)) && !/\b(?:accept cookies|cookie settings|subscribe to (?:our|the) newsletter|all rights reserved)\b/i.test(line));
  });
  if (!firstParty.length) return null;
  const description = firstParty.join(' ');
  const names = [...new Set([...products,context.vendor].filter(Boolean))];
  const target = patterns(names);
  const records = [...context.documents.values()].filter(doc => isEnforcementSource(doc) && !context.vendorDocs.includes(doc))
    .map(doc => ({doc,lines:statements(doc)}));
  let historical;
  for (const record of records) {
    const {doc,lines} = record;
    const actions = lines.filter(line => target.sanction.test(line) && qualifies(line,doc) && !differentMatter.test(line));
    for (const action of actions) {
      const tailOf = line => {
        const respondent = target.sanction.exec(line);
        return line.slice(respondent.index + respondent[0].length);
      };
      const tail = tailOf(action);
      const statedCause = statedReason(tail);
      if (statedCause && (!actorAction.test(statedCause) || !materialPractice(action))) continue;
      const aliases = [...shortForms(action,names), ...headlineAlias(action,doc.title,statedCause,names)];
      const actor = patterns([...names,...aliases]);
      const appliesToProduct = product.sanction.test(action);
      const practices = lines.filter(line => {
        if (!materialPractice(line) || !affectsService(line,description,named([...products,...aliases])) ||
            (!appliesToProduct && !product.name.test(line))) return false;
        if (line === action) return !!statedCause || /\b(?:to (?:stop|cease|delete)|from (?:selling|collecting|processing|sharing))\b/i.test(tail);
        // A separate finding must name the actor performing the practice.
        // Proximity or a reference to the product as a victim is insufficient.
        return actor.actor.test(line) && !/\b(?:reported|alleged|claimed|complained|warned) that\b/i.test(line);
      });
      const practice = practices.find(line => geographicScope.test(line)) || practices[0];
      if (!practice) continue;
      // Press notices often identify the product/practice in their lead and
      // state the amount in a separate full-name disposition from the same issuer.
      const amounts = actions.filter(line => fineAmount.test(line) && sameIssuer(action,line) &&
        (!statedReason(tailOf(line)) || statedReason(tailOf(line)) === statedCause));
      const distinctAmounts = new Set(amounts.map(line => line.match(fineAmount)[0].trim().toLowerCase()));
      const monetary = !fineAmount.test(action) && distinctAmounts.size === 1 && amounts[0];
      const remedyTarget = new RegExp('\\b(?:on|against)\\s+' + named([...names,...aliases]),'iu');
      const remedy = lines.find(line => line !== action && qualifies(line,doc) && remedyTarget.test(line) &&
        /\b(?:impose[ds]?|issued) .{0,35}\b(?:orders?|injunctions?)\b/i.test(line) && /\b(?:ending|ceas\w*|prohibit\w*|stop|remedy|remediate)\b.{0,80}\b(?:violations?|process\w*|collect\w*|data)\b/i.test(line));
      const update = statusUpdate(record,records,actor.name);
      const date = clean(doc.text).match(dispositionDate)?.[0];
      const result = {doc,action:monetary || action,practice,date,remedy,update,
        scopeStatement:monetary && action !== practice ? action : null};
      if (!update || update.status === 'operative') return result;
      historical ??= result;
    }
  }
  return historical;
}
