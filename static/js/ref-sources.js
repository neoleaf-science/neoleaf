// Article sources for the "References" tab: each source knows how to build the query and normalize the result. Everything runs in the browser:
// Crossref, OpenAlex, PubMed, Europe PMC, DOAJ, HAL, Zenodo and OpenAIRE allow the browser (CORS) and are queried directly.
// arXiv and DBLP do not, so they go through the server's stateless proxy (GET /api/scholar, src/scholar.rs).
//
// Each result becomes { source, title, authors[], year, venue, doi, url, pdf, abstract, type, volume, issue, pages, publisher, eprint }
// and `toBibtex` builds the entry. The texts come from third parties: nothing here enters the page as HTML.
(function () {
  'use strict';

  const CONTACT = 'contact@neoleaf.science';
  const TIMEOUT_MS = 20000;
  const enc = encodeURIComponent;

  // ------------------------------------------------------------ utilities
  const DOI_RE = /^(?:doi:\s*|https?:\/\/(?:dx\.)?doi\.org\/)?(10\.\d{4,9}\/\S+)$/i;
  const parseDoi = s => { const m = DOI_RE.exec(String(s || '').trim()); return m ? m[1].replace(/[.,;]+$/, '') : ''; };
  const normDoi = s => parseDoi(s).toLowerCase();

  function clean(s) {
    if (s === null || s === undefined) return '';
    s = String(s);
    if (/[<&]/.test(s)) s = new DOMParser().parseFromString(s, 'text/html').documentElement.textContent || '';
    return s.replace(/\s+/g, ' ').trim();
  }
  const first = v => (Array.isArray(v) ? v[0] : v);
  const yearOf = v => { const m = /(\d{4})/.exec(String(v === undefined || v === null ? '' : v)); return m ? +m[1] : null; };
  const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

  async function getText(url) {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
    try {
      const r = await fetch(url, { signal: ctl.signal, credentials: url.startsWith('/') ? 'same-origin' : 'omit' });
      if (!r.ok) {
        let msg = '';
        if (url.startsWith('/')) { try { msg = (await r.json()).error || ''; } catch (_) { /* no body */ } }
        throw new Error(msg || (r.status === 429 || r.status === 503 ? 'rate limiting queries right now, try again' : 'error ' + r.status));
      }
      return await r.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new Error('took too long');
      throw e;
    } finally { clearTimeout(timer); }
  }
  async function getJson(url) { return JSON.parse(await getText(url)); }

  // "Family, Given" when possible; a plain name becomes "Surname, Given" (last word as the surname)
  function person(given, family, full) {
    given = clean(given); family = clean(family); full = clean(full);
    if (family) return given ? family + ', ' + given : family;
    if (!full) return '';
    if (full.includes(',')) return full;
    const parts = full.split(' ');
    return parts.length > 1 ? parts[parts.length - 1] + ', ' + parts.slice(0, -1).join(' ') : full;
  }
  const people = list => (list || []).filter(Boolean);
  // "Silva AB" (surname and initials, as PubMed and Europe PMC write them) becomes "Silva, A. B."
  function initialsName(n) {
    n = clean(n);
    const m = /^(.+?)\s+([A-Z]{1,4})$/.exec(n);
    return m ? m[1] + ', ' + m[2].split('').map(c => c + '.').join(' ') : person('', '', n);
  }

  const page = (limit, offset) => Math.floor(offset / Math.max(limit, 1)) + 1;

  // ------------------------------------------------------------ sources
  const SOURCES = [];
  const add = s => SOURCES.push(s);

  add({
    id: 'crossref', name: 'Crossref', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const sel = '&select=DOI,title,author,issued,published-print,published-online,container-title,type,volume,issue,page,publisher,URL,link,abstract';
      const url = doi ? `https://api.crossref.org/works/${enc(doi)}?mailto=${CONTACT}`
        : `https://api.crossref.org/works?query.bibliographic=${enc(q)}&rows=${limit}&offset=${offset}&mailto=${CONTACT}${sel}`;
      const d = await getJson(url);
      const items = doi ? [d.message] : ((d.message && d.message.items) || []);
      return items.filter(Boolean).map(w => {
        const dp = x => x && x['date-parts'] && x['date-parts'][0] && x['date-parts'][0][0];
        let pdf = '';
        for (const l of (w.link || [])) if (/pdf/i.test(l['content-type'] || '') && safeUrl(l.URL) && !/doi\.org/i.test(l.URL)) { pdf = l.URL; break; }
        return {
          title: clean(first(w.title)), authors: people((w.author || []).map(a => person(a.given, a.family, a.name))),
          year: dp(w.issued) || dp(w['published-print']) || dp(w['published-online']) || null, venue: clean(first(w['container-title'])),
          doi: normDoi(w.DOI), url: safeUrl(w.URL), pdf, abstract: clean(w.abstract), type: w.type || '',
          volume: clean(w.volume), issue: clean(w.issue), pages: clean(w.page), publisher: clean(w.publisher),
        };
      });
    },
  });

  add({
    id: 'openalex', name: 'OpenAlex', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const url = doi ? `https://api.openalex.org/works/doi:${enc(doi)}?mailto=${CONTACT}`
        : `https://api.openalex.org/works?search=${enc(q)}&per_page=${limit}&page=${page(limit, offset)}&mailto=${CONTACT}`;
      const d = await getJson(url);
      const items = doi ? [d] : (d.results || []);
      return items.filter(Boolean).map(w => {
        const src = (w.primary_location && w.primary_location.source) || {};
        const bib = w.biblio || {};
        const pages = bib.first_page ? (bib.last_page && bib.last_page !== bib.first_page ? bib.first_page + '-' + bib.last_page : bib.first_page) : '';
        const loc = w.best_oa_location || w.primary_location || {};
        return {
          title: clean(w.display_name || w.title), authors: people((w.authorships || []).map(a => person('', '', a.author && a.author.display_name))),
          year: w.publication_year || null, venue: clean(src.display_name), doi: normDoi(w.doi), url: safeUrl(w.doi) || safeUrl(loc.landing_page_url),
          pdf: safeUrl(loc.pdf_url) || safeUrl((w.open_access || {}).oa_url), abstract: '', type: w.type || '', volume: clean(bib.volume), issue: clean(bib.issue),
          pages: clean(pages), publisher: clean(src.host_organization_name),
        };
      });
    },
  });

  add({
    id: 'pubmed', name: 'PubMed', direct: true,
    async search(q, { limit, offset }) {
      const base = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils/';
      const s = await getJson(`${base}esearch.fcgi?db=pubmed&term=${enc(q)}&retmode=json&retmax=${limit}&retstart=${offset}&tool=neoleaf&email=${CONTACT}`);
      const ids = (s.esearchresult && s.esearchresult.idlist) || [];
      if (!ids.length) return [];
      const d = await getJson(`${base}esummary.fcgi?db=pubmed&id=${ids.join(',')}&retmode=json&tool=neoleaf&email=${CONTACT}`);
      return ids.map(id => ({ id, w: (d.result || {})[id] })).filter(x => x.w && x.w.title).map(({ id, w }) => {
        const doiId = (w.articleids || []).find(a => a.idtype === 'doi');
        return {
          title: clean(w.title).replace(/\.$/, ''), authors: people((w.authors || []).map(a => initialsName(a.name))), year: yearOf(w.pubdate),
          venue: clean(w.fulljournalname || w.source), doi: normDoi(doiId && doiId.value), url: 'https://pubmed.ncbi.nlm.nih.gov/' + id + '/', pdf: '', abstract: '',
          type: 'journal-article', volume: clean(w.volume), issue: clean(w.issue), pages: clean(w.pages), publisher: '',
        };
      });
    },
  });

  add({
    id: 'europepmc', name: 'Europe PMC', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const query = doi ? `DOI:"${doi}"` : q;
      const size = Math.min(limit + offset, 100);
      const d = await getJson(`https://www.ebi.ac.uk/europepmc/webservices/rest/search?query=${enc(query)}&format=json&resultType=core&pageSize=${size}`);
      const all = (d.resultList && d.resultList.result) || [];
      return all.slice(offset, offset + limit).map(w => {
        const ft = ((w.fullTextUrlList && w.fullTextUrlList.fullTextUrl) || []).find(u => /pdf/i.test(u.documentStyle || '') && /free|open/i.test(u.availability || '') && safeUrl(u.url));
        const authors = clean(w.authorString).replace(/\.$/, '').split(/,\s*/).filter(Boolean).map(initialsName);
        return {
          title: clean(w.title).replace(/\.$/, ''), authors, year: yearOf(w.pubYear), venue: clean(w.journalInfo && w.journalInfo.journal && w.journalInfo.journal.title),
          doi: normDoi(w.doi), url: w.pmid ? 'https://europepmc.org/article/MED/' + w.pmid : '', pdf: ft ? ft.url : '', abstract: clean(w.abstractText), type: 'journal-article',
          volume: clean(w.journalInfo && w.journalInfo.volume), issue: clean(w.journalInfo && w.journalInfo.issue), pages: clean(w.pageInfo), publisher: '',
        };
      });
    },
  });

  add({
    id: 'doaj', name: 'DOAJ', direct: true,
    async search(q, { limit, offset }) {
      const d = await getJson(`https://doaj.org/api/search/articles/${enc(q)}?page=${page(limit, offset)}&pageSize=${limit}`);
      return (d.results || []).map(it => {
        const b = it.bibjson || {};
        const idDoi = (b.identifier || []).find(i => i.type === 'doi');
        const ft = (b.link || []).find(l => l.type === 'fulltext' && safeUrl(l.url));
        const pages = b.start_page ? (b.end_page && b.end_page !== b.start_page ? b.start_page + '-' + b.end_page : b.start_page) : '';
        return {
          title: clean(b.title), authors: people((b.author || []).map(a => person('', '', a.name))), year: yearOf(b.year), venue: clean(b.journal && b.journal.title),
          doi: normDoi(idDoi && idDoi.id), url: ft ? ft.url : '', pdf: '', abstract: clean(b.abstract), type: 'journal-article', volume: clean(b.journal && b.journal.volume),
          issue: clean(b.journal && b.journal.number), pages: clean(pages), publisher: clean(b.journal && b.journal.publisher),
        };
      }).filter(r => r.title);
    },
  });

  add({
    id: 'hal', name: 'HAL', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const query = doi ? `doiId_s:"${doi}"` : q;
      const fl = 'title_s,authFullName_s,doiId_s,producedDateY_i,fileMain_s,abstract_s,journalTitle_s,conferenceTitle_s,bookTitle_s,uri_s,docType_s';
      const d = await getJson(`https://api.hal.science/search/?q=${enc(query)}&rows=${limit}&start=${offset}&wt=json&fl=${enc(fl)}`);
      return ((d.response && d.response.docs) || []).map(w => ({
        title: clean(first(w.title_s)), authors: people((w.authFullName_s || []).map(n => person('', '', n))), year: w.producedDateY_i || null,
        venue: clean(first(w.journalTitle_s) || first(w.conferenceTitle_s) || first(w.bookTitle_s)), doi: normDoi(w.doiId_s), url: safeUrl(w.uri_s), pdf: safeUrl(w.fileMain_s),
        abstract: clean(first(w.abstract_s)), type: w.docType_s === 'COMM' ? 'proceedings-article' : (w.docType_s === 'ART' ? 'journal-article' : ''), volume: '', issue: '', pages: '', publisher: '',
      })).filter(r => r.title);
    },
  });

  add({
    id: 'zenodo', name: 'Zenodo', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const query = doi ? `doi:"${doi}"` : q;
      const d = await getJson(`https://zenodo.org/api/records?q=${enc(query)}&type=publication&size=${limit}&page=${page(limit, offset)}`);
      return ((d.hits && d.hits.hits) || []).map(r => {
        const m = r.metadata || {};
        const file = (r.files || []).find(f => /\.pdf$/i.test(f.key || f.filename || '') && f.links && safeUrl(f.links.self));
        return {
          title: clean(m.title), authors: people((m.creators || []).map(c => person('', '', c.name))), year: yearOf(m.publication_date), venue: clean(m.journal && m.journal.title),
          doi: normDoi(r.doi || m.doi), url: safeUrl(r.links && r.links.self_html) || safeUrl(r.links && r.links.html), pdf: file ? file.links.self : '', abstract: clean(m.description),
          type: m.resource_type && m.resource_type.subtype === 'article' ? 'journal-article' : '', volume: clean(m.journal && m.journal.volume), issue: clean(m.journal && m.journal.issue),
          pages: clean(m.journal && m.journal.pages), publisher: '',
        };
      }).filter(r => r.title);
    },
  });

  add({
    id: 'openaire', name: 'OpenAIRE', direct: true, doi: true,
    async search(q, { limit, offset }) {
      const doi = parseDoi(q);
      const url = `https://api.openaire.eu/graph/v1/researchProducts?type=publication&pageSize=${limit}&page=${page(limit, offset)}` + (doi ? `&pid=${enc(doi)}` : `&search=${enc(q)}`);
      const d = await getJson(url);
      return (d.results || []).map(w => {
        const pid = (w.pids || []).find(p => /doi/i.test(p.scheme || p.type || ''));
        const urls = [].concat(...(w.instances || []).map(i => i.urls || [])).filter(safeUrl);
        return {
          title: clean(w.mainTitle), authors: people((w.authors || []).map(a => person('', '', a.fullName))), year: yearOf(w.publicationDate), venue: clean((w.container && w.container.name) || ''),
          doi: normDoi(pid && pid.value), url: urls[0] || '', pdf: urls.find(u => /\.pdf(\?|$)/i.test(u)) || '', abstract: clean(first(w.descriptions)), type: '', volume: '', issue: '', pages: '',
          publisher: clean(w.publisher),
        };
      }).filter(r => r.title);
    },
  });

  add({
    id: 'arxiv', name: 'arXiv', direct: false,
    async search(q, { limit, offset }) {
      const xml = new DOMParser().parseFromString(await getText(`/api/scholar?source=arxiv&q=${enc(q)}&limit=${limit}&offset=${offset}`), 'application/xml');
      const tag = (e, n) => { const x = e.getElementsByTagName(n)[0]; return x ? x.textContent : ''; };
      return Array.from(xml.getElementsByTagName('entry')).map(e => {
        const idUrl = clean(tag(e, 'id'));
        const arxivId = (idUrl.split('/abs/')[1] || idUrl.split('/').pop() || '').replace(/v\d+$/, '');
        const pdfLink = Array.from(e.getElementsByTagName('link')).find(l => l.getAttribute('title') === 'pdf');
        return {
          title: clean(tag(e, 'title')), authors: people(Array.from(e.getElementsByTagName('author')).map(a => person('', '', tag(a, 'name')))), year: yearOf(tag(e, 'published')),
          venue: clean(tag(e, 'arxiv:journal_ref')), doi: normDoi(tag(e, 'arxiv:doi')), url: arxivId ? 'https://arxiv.org/abs/' + arxivId : safeUrl(idUrl),
          pdf: arxivId ? 'https://arxiv.org/pdf/' + arxivId : safeUrl(pdfLink && pdfLink.getAttribute('href')), abstract: clean(tag(e, 'summary')), type: 'preprint',
          volume: '', issue: '', pages: '', publisher: '', eprint: arxivId,
        };
      }).filter(r => r.title);
    },
  });

  add({
    id: 'dblp', name: 'DBLP', direct: false,
    async search(q, { limit, offset }) {
      const d = await getJson(`/api/scholar?source=dblp&q=${enc(q)}&limit=${limit}&offset=${offset}`);
      let hits = (d.result && d.result.hits && d.result.hits.hit) || [];
      if (hits.info) hits = [hits];
      return hits.map(h => h.info || {}).map(i => {
        let au = i.authors && i.authors.author;
        au = !au ? [] : (Array.isArray(au) ? au : [au]);
        const t = (i.type || '').toLowerCase();
        const ee = safeUrl(i.ee);
        return {
          title: clean(i.title).replace(/\.$/, ''), authors: people(au.map(a => person('', '', clean(typeof a === 'string' ? a : a.text).replace(/\s+\d{4}$/, '')))), year: yearOf(i.year),
          venue: clean(i.venue), doi: normDoi(i.doi), url: ee || safeUrl(i.url), pdf: ee && /\.pdf(\?|$)/i.test(ee) ? ee : '', abstract: '',
          type: t.includes('journal') ? 'journal-article' : (t.includes('conference') ? 'proceedings-article' : (t.includes('book') ? 'book' : '')), volume: clean(i.volume),
          issue: clean(i.number), pages: clean(i.pages), publisher: clean(i.publisher),
        };
      }).filter(r => r.title);
    },
  });

  // queries a source and fills in the missing fields
  async function run(id, q, opts) {
    const src = SOURCES.find(x => x.id === id);
    if (!src) throw new Error('unknown source');
    const blank = { authors: [], year: null, venue: '', doi: '', url: '', pdf: '', abstract: '', type: '', volume: '', issue: '', pages: '', publisher: '', eprint: '' };
    return (await src.search(q, opts)).filter(r => r && r.title).map(r => Object.assign({}, blank, r, { source: src.name }));
  }

  // open-access PDF of a DOI (Unpaywall); '' when there is none
  async function openPdf(doi) {
    const d = await getJson(`https://api.unpaywall.org/v2/${enc(doi)}?email=${CONTACT}`);
    const loc = d.best_oa_location;
    return d.is_oa && loc ? (safeUrl(loc.url_for_pdf) || safeUrl(loc.url)) : '';
  }

  // ------------------------------------------------------------ unique result
  function dedupe(items) {
    const seen = new Map();
    const out = [];
    for (const it of items) {
      const t = it.title.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
      const k = it.doi ? 'doi:' + it.doi : (it.eprint ? 'arxiv:' + it.eprint : 't:' + t + '|' + (it.year || ''));
      const alt = 't:' + t + '|' + (it.year || '');
      const hit = seen.get(k) || seen.get(alt);
      if (hit) {
        if (!hit.sources.includes(it.source)) hit.sources.push(it.source);
        for (const f of ['venue', 'doi', 'url', 'pdf', 'abstract', 'volume', 'issue', 'pages', 'publisher', 'eprint', 'type']) if (!hit[f] && it[f]) hit[f] = it[f];
        if (!hit.authors.length && it.authors.length) hit.authors = it.authors;
        if (!hit.year && it.year) hit.year = it.year;
        continue;
      }
      const item = Object.assign({}, it, { sources: [it.source] });
      seen.set(k, item); seen.set(alt, item);
      out.push(item);
    }
    return out;
  }

  // ------------------------------------------------------------ BibTeX
  const STOP = new Set(['a', 'an', 'the', 'of', 'on', 'in', 'for', 'and', 'to', 'with', 'um', 'uma', 'o', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'em', 'para', 'e', 'por', 'sobre', 'from', 'by', 'at', 'is', 'are']);
  const ascii = s => String(s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');

  function baseKey(it) {
    const a = it.authors[0] || '';
    const family = ascii(a.includes(',') ? a.split(',')[0] : a.split(' ').pop()) || 'anon';
    const word = String(it.title || '').split(/\s+/).map(ascii).find(w => w.length >= 3 && !STOP.has(w)) || '';
    return family + (it.year || '') + word;
  }
  function uniqueKey(it, taken) {
    const base = baseKey(it);
    if (!taken.has(base)) return base;
    for (let i = 0; i < 26; i++) { const k = base + String.fromCharCode(97 + i); if (!taken.has(k)) return k; }
    let n = 2; while (taken.has(base + n)) n++;
    return base + n;
  }

  // BibTeX values: no stray braces (they would break the file) and with special characters escaped
  // (a backslash is escaped too: a title like "\input /etc/x" from third-party metadata must stay text in the .bib)
  const val = s => clean(s).replace(/[{}]/g, '').replace(/[\\&%#_$^~]/g, c => (c === '\\' ? '\\textbackslash{}' : c === '^' ? '\\textasciicircum{}' : c === '~' ? '\\textasciitilde{}' : '\\' + c));
  const urlSafe = s => String(s || '').replace(/[{}\\\s]/g, '');
  const kind = it => {
    const t = String(it.type || '').toLowerCase();
    if (it.eprint && !it.venue) return 'misc';
    if (/proceedings|conference|inproceedings/.test(t)) return 'inproceedings';
    if (/book-chapter|incollection/.test(t)) return 'incollection';
    if (/^book|monograph|edited-book/.test(t)) return 'book';
    if (/journal|article/.test(t) && !/proceedings/.test(t)) return 'article';
    if (/preprint|posted-content|dataset|report/.test(t) || !it.venue) return 'misc';
    return 'article';
  };

  function toBibtex(it, key) {
    const k = kind(it);
    const f = [];
    const put = (n, v, brace) => { if (v) f.push(`  ${n} = {${brace ? '{' + v + '}' : v}}`); };
    put('author', it.authors.map(val).join(' and '));
    put('title', val(it.title), true);
    if (k === 'article') put('journal', val(it.venue));
    else if (k === 'inproceedings' || k === 'incollection') put('booktitle', val(it.venue));
    else if (it.venue) put('howpublished', val(it.venue));
    put('year', it.year ? String(it.year) : '');
    put('volume', val(it.volume));
    put('number', val(it.issue));
    put('pages', val(it.pages).replace(/\s*[-–—]+\s*/g, '--'));
    put('publisher', val(it.publisher));
    put('doi', urlSafe(it.doi));
    if (it.eprint) { put('eprint', val(it.eprint)); put('archivePrefix', 'arXiv'); }
    if (!it.doi && it.url) put('url', urlSafe(it.url));
    return `@${k}{${key},\n${f.join(',\n')}\n}\n`;
  }

  window.RefSources = { list: SOURCES, run, parseDoi, normDoi, openPdf, dedupe, toBibtex, uniqueKey, baseKey };
})();
