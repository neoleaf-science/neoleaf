import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { BASE_URL, fake, newSession, openInTree, openProject, poll, settled, type Session } from '../helpers';

// "References" tab: searches articles (sources queried directly by the browser and arXiv/DBLP through the server proxy), inserts \cite in the
// text and the entry in the .bib. External APIs are mocked (page.route) and arXiv and DBLP are the fake ones of the test server.
describe('references', () => {
  let s: Session;
  const ev = <T>(code: string) => s.page.evaluate(c => (0, eval)(c), code) as Promise<T>;
  const calls: Record<string, string[]> = {};
  const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };

  const crossref = (items: unknown[]) => ({ message: { items } });
  const CR_ITEMS = [
    { DOI: '10.1000/arxiv.1', title: ['Deep Learning for Test Smells'], author: [{ given: 'Ana', family: 'Silva' }, { given: 'Bruno', family: 'Costa' }], issued: { 'date-parts': [[2024]] }, 'container-title': ['Journal of Tests'], type: 'journal-article', volume: '12', issue: '3', page: '10-19', publisher: 'Editora & Co', URL: 'https://doi.org/10.1000/arxiv.1' },
    { DOI: '10.1000/xss', title: ['<img src=x onerror="window.__xss=1">Dangerous <b>article</b>'], author: [{ name: 'John Doe' }], issued: { 'date-parts': [[2022]] }, 'container-title': ['Journal'], type: 'journal-article', URL: 'javascript:alert(1)' },
    { DOI: '10.1000/dup', title: ['Article already in the .bib'], author: [{ given: 'Dora', family: 'Duplicada' }], issued: { 'date-parts': [[2020]] }, 'container-title': ['Old Journal'], type: 'journal-article' },
  ];

  const mock = async (host: string, body: unknown | ((url: string) => unknown), status = 200, contentType = 'application/json') => {
    await s.page.route(new RegExp('^https://' + host.replace(/\./g, '\\.') + '/'), route => {
      const url = route.request().url();
      (calls[host] ||= []).push(url);
      const b = typeof body === 'function' ? (body as (u: string) => unknown)(url) : body;
      return route.fulfill({ status, headers: { ...CORS, 'content-type': contentType }, body: typeof b === 'string' ? b : JSON.stringify(b) });
    });
  };

  const openTab = async () => { await s.page.click('#tab-refs-btn'); await s.page.waitForSelector('#refs-q'); };
  const search = async (q: string) => { await s.page.fill('#refs-q', q); await s.page.keyboard.press('Enter'); await poll(() => s.page.locator('.refs-status').count(), n => n > 0, 20000); await poll(() => s.page.locator('#refs-container .cmt-empty', { hasText: 'Searching' }).count(), n => n === 0, 20000); };
  const cards = () => s.page.locator('.refs-card');
  const card = (text: string) => s.page.locator('.refs-card', { hasText: text });
  const chip = (name: string) => s.page.locator('.refs-chip', { hasText: name });
  const clearSources = async (ids: string[]) => {
    for (const name of ['Crossref', 'OpenAlex', 'PubMed', 'Europe PMC', 'DOAJ', 'HAL', 'Zenodo', 'OpenAIRE', 'arXiv', 'DBLP']) {
      const on = await chip(name).first().evaluate(e => e.classList.contains('on'));
      if (on !== ids.includes(name)) await chip(name).first().click();
    }
  };

  beforeAll(async () => {
    fake.seedRepo('demo', 'refs', {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nText here.\n\\bibliography{refs}\n\\end{document}\n',
      'refs.bib': '@article{existente2020,\n  author = {Duplicada, Dora},\n  title = {{Article already in the .bib}},\n  year = {2020},\n  doi = {10.1000/dup}\n}\n',
    }, ['neoleaf']);
    fake.seedRepo('demo', 'refs-no-bib', {
      'main.tex': '\\documentclass{article}\n\\begin{document}\nNo bib.\n\\end{document}\n',
    }, ['neoleaf']);
    s = await newSession();
    // nothing goes out to the internet: whatever is not mocked gives a 500 error
    for (const h of ['api.crossref.org', 'api.openalex.org', 'eutils.ncbi.nlm.nih.gov', 'www.ebi.ac.uk', 'doaj.org', 'api.hal.science', 'zenodo.org', 'api.openaire.eu', 'api.unpaywall.org']) await mock(h, { error: 'not mocked' }, 500);
    await mock('api.crossref.org', crossref(CR_ITEMS));
    await openProject(s.page, 'demo__refs');
  });
  afterAll(async () => { await s.context.close(); });

  test('the References tab appears, with the sources and the target .bib', async () => {
    await openTab();
    for (const name of ['Crossref', 'OpenAlex', 'PubMed', 'Europe PMC', 'DOAJ', 'HAL', 'Zenodo', 'OpenAIRE', 'arXiv', 'DBLP']) expect(await chip(name).count()).toBe(1);
    expect(await s.page.locator('#refs-target').inputValue()).toBe('refs.bib');
    // arXiv and DBLP warn that they go through the server
    expect(await chip('arXiv').getAttribute('title')).toContain('server');
  });

  test('searches several sources, merges the same DOI and shows the error of one source without blocking the others', async () => {
    await clearSources(['Crossref', 'OpenAlex', 'arXiv', 'DBLP']);
    await search('test smells');
    // Crossref (3) + arXiv (1, with the same DOI as the first Crossref one) + DBLP (2) = 5 after merging
    await poll(() => cards().count(), n => n === 5, 20000);
    const merged = card('Deep Learning for Test Smells');
    expect(await merged.count()).toBe(1);
    expect(await merged.locator('.refs-meta').textContent()).toContain('Crossref + arXiv');
    const status = await s.page.locator('.refs-status').textContent();
    expect(status).toContain('Crossref: 3');
    expect(status).toContain('arXiv: 1');
    expect(status).toContain('DBLP: 2');
    expect(status).toContain('OpenAlex: error');
    // the proxy received the arXiv request with each word joined by AND
    expect(fake.scholarLog.some(l => l.startsWith('arxiv?') && l.includes('max_results=10') && decodeURIComponent(l.replace(/\+/g, ' ')).includes('all:test AND all:smells'))).toBe(true);
    expect(fake.scholarLog.some(l => l.startsWith('dblp?') && l.includes('format=json'))).toBe(true);
  });

  test('third-party texts enter as text: no HTML, no script and no dangerous link', async () => {
    const c = card('Dangerous article');
    expect(await c.count()).toBe(1);
    expect(await c.locator('.refs-title').textContent()).toBe('Dangerous article');
    expect(await s.page.locator('#refs-container img, #refs-container script').count()).toBe(0);
    expect(await ev<boolean>('window.__xss === undefined')).toBe(true);
    // the javascript: URL was discarded; the link falls back to the DOI
    expect(await c.locator('.refs-title a').getAttribute('href')).toBe('https://doi.org/10.1000/xss');
    expect(await c.locator('.refs-title a').getAttribute('rel')).toContain('noopener');
  });

  test('\\cite: creates the entry in the .bib, inserts the citation at the cursor and returns to the text', async () => {
    await openInTree(s.page, 'main.tex');
    await ev(`editor.setPosition({ lineNumber: 3, column: 11 })`);   // after "Text here."
    await openTab();
    await card('Deep Learning for Test Smells').locator('button', { hasText: '\\cite' }).click();
    const bib = await poll(() => ev<string>(`BrowserGit.readFile('refs.bib')`), v => v.includes('silva2024deep'), 30000);
    expect(bib).toContain('@article{silva2024deep,');
    expect(bib).toContain('author = {Silva, Ana and Costa, Bruno}');
    expect(bib).toContain('title = {{Deep Learning for Test Smells}}');
    expect(bib).toContain('journal = {Journal of Tests}');
    expect(bib).toContain('pages = {10--19}');
    expect(bib).toContain('publisher = {Editora \\& Co}');
    expect(bib).toContain('doi = {10.1000/arxiv.1}');
    expect(bib).toContain('@article{existente2020,');   // what was already there stays
    await poll(() => ev<string>('currentFileId'), v => v === 'main.tex', 20000);
    const tex = await poll(() => ev<string>(`BrowserGit.readFile('main.tex')`), v => v.includes('\\cite{silva2024deep}'), 30000);
    expect(tex).toContain('Text here.\\cite{silva2024deep}');
    expect(await s.page.locator('.refs-msg').textContent()).toContain('refs.bib');
  });

  test('a DOI already in the .bib reuses the key and does not duplicate the entry', async () => {
    await openInTree(s.page, 'main.tex');
    await ev(`editor.setPosition({ lineNumber: 4, column: 1 })`);
    const before = (await ev<string>(`BrowserGit.readFile('refs.bib')`)).split('@').length;
    await openTab();
    await card('Article already in the .bib').locator('button', { hasText: '\\cite' }).click();
    const tex = await poll(() => ev<string>(`BrowserGit.readFile('main.tex')`), v => v.includes('\\cite{existente2020}'), 30000);
    expect(tex).toContain('\\cite{existente2020}');
    expect((await ev<string>(`BrowserGit.readFile('refs.bib')`)).split('@').length).toBe(before);
    expect(await s.page.locator('.refs-msg').textContent()).toContain('Already in refs.bib');
  });

  test('"Adicionar ao .bib" writes only the entry (new key if the base already exists) and returns to the source file', async () => {
    await openInTree(s.page, 'main.tex');
    const before = await ev<string>(`BrowserGit.readFile('main.tex')`);
    await openTab();
    await card('Mining Test Smells in Dart').locator('button', { hasText: 'Add to .bib' }).click();
    const bib = await poll(() => ev<string>(`BrowserGit.readFile('refs.bib')`), v => v.includes('silva2024mining'), 30000);
    expect(bib).toContain('@inproceedings{silva2024mining,');
    expect(bib).toContain('author = {Silva, Ana and Costa, Bruno}');   // the DBLP "Ana Silva 0001" becomes "Silva, Ana"
    expect(bib).toContain('booktitle = {SBES}');
    expect(bib).toContain('pages = {10--19}');
    await poll(() => ev<string>('currentFileId'), v => v === 'main.tex', 20000);
    expect(await ev<string>(`BrowserGit.readFile('main.tex')`)).toBe(before);   // the text did not change
  });

  test('"BibTeX" copies the entry to the clipboard', async () => {
    await s.context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await openTab();
    await card('A Journal Article').locator('button', { hasText: 'BibTeX' }).click();
    const txt = await poll(() => s.page.evaluate(() => navigator.clipboard.readText()), v => v.includes('@article{'), 10000);
    expect(txt).toContain('author = {Souza, Carla}');
    expect(txt).toContain('journal = {J. Syst. Softw.}');
    expect(txt).toContain('volume = {200}');
    expect(txt).toContain('number = {3}');
  });

  test('DOI search queries only the sources that accept DOI', async () => {
    calls['api.crossref.org'] = [];
    fake.scholarLog.length = 0;
    await clearSources(['Crossref', 'arXiv', 'DBLP']);
    await mock('api.crossref.org', { message: CR_ITEMS[0] });
    await search('https://doi.org/10.1000/arxiv.1');
    await poll(() => cards().count(), n => n === 1, 20000);
    expect(calls['api.crossref.org'].some(u => u.includes('/works/10.1000%2Farxiv.1'))).toBe(true);
    expect(fake.scholarLog.length).toBe(0);   // arXiv and DBLP were not queried
    await mock('api.crossref.org', crossref(CR_ITEMS));
  });

  test('arXiv e DBLP: the proxy requires a session, validates the source and the text and relays the error from the source', async () => {
    const anon = await fetch(`${BASE_URL}/api/scholar?source=arxiv&q=test`);
    expect(anon.status).toBe(401);
    const get = (qs: string) => s.page.request.get(`${BASE_URL}/api/scholar?${qs}`);
    expect((await get('source=crossref&q=test')).status()).toBe(400);   // only the two known sources
    expect((await get('source=..%2Fx&q=test')).status()).toBe(400);
    expect((await get('source=arxiv&q=')).status()).toBe(400);
    expect((await get('source=arxiv&q=' + 'a'.repeat(301))).status()).toBe(400);
    const ok = await get('source=dblp&q=test&limit=999&offset=999999');
    expect(ok.status()).toBe(200);
    expect(ok.headers()['cache-control']).toBe('no-store');
    expect(fake.scholarLog.at(-1)).toContain('h=30');   // maximum page size
    expect(fake.scholarLog.at(-1)).toContain('f=500');   // maximum offset
    const bad = await get('source=arxiv&q=erro503');
    expect(bad.status()).toBe(502);
    expect((await bad.json()).error).toContain('limiting');
  });

  test('with no .bib in the project, references.bib is created and receives the entry', async () => {
    await openProject(s.page, 'demo__refs-no-bib');
    await ev(`editor.setPosition({ lineNumber: 3, column: 8 })`);
    await openTab();
    await clearSources(['Crossref']);
    expect(await s.page.locator('#refs-target').inputValue()).toBe('references.bib');
    await search('test smells');
    await poll(() => cards().count(), n => n >= 1, 20000);
    await card('Deep Learning for Test Smells').locator('button', { hasText: '\\cite' }).click();
    const bib = await poll(() => ev<string>(`BrowserGit.readFile('references.bib').catch(() => '')`), v => v.includes('silva2024deep'), 30000);
    expect(bib).toContain('@article{silva2024deep,');
    await poll(() => ev<string>('currentFileId'), v => v === 'main.tex', 20000);
    await poll(() => ev<string>(`BrowserGit.readFile('main.tex')`), v => v.includes('No bib.\\cite{silva2024deep}'), 30000);
    expect(await s.page.locator('#file-tree .tree-row', { hasText: 'references.bib' }).count()).toBe(1);
  });
});

// Each direct source returns its own format; the browser normalizes title, authors, year, DOI and PDF.
describe('references: the direct sources normalize the results', () => {
  let s: Session;
  const CORS = { 'access-control-allow-origin': '*', 'content-type': 'application/json' };
  const mock = (host: string, body: unknown) => s.page.route(new RegExp('^https://' + host.replace(/\./g, '\\.') + '/'), route => route.fulfill({ status: 200, headers: CORS, body: JSON.stringify(body) }));
  const run = (id: string) => s.page.evaluate(async i => (window as any).RefSources.run(i, 'topic', { limit: 10, offset: 0 }), id) as Promise<any[]>;

  beforeAll(async () => {
    fake.seedRepo('demo', 'refs-fontes', { 'main.tex': '\\documentclass{article}\n\\begin{document}Oi\n\\end{document}\n' }, ['neoleaf']);
    s = await newSession();
    await mock('api.openalex.org', { results: [{ display_name: 'OpenAlex Article', authorships: [{ author: { display_name: 'Maria Souza' } }], publication_year: 2021, doi: 'https://doi.org/10.1111/OA', primary_location: { source: { display_name: 'Rev OA' } }, best_oa_location: { pdf_url: 'https://example.org/oa.pdf' }, biblio: { volume: '5', issue: '2', first_page: '10', last_page: '20' }, type: 'article' }] });
    await s.page.route(/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esearch/, r => r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ esearchresult: { idlist: ['123'] } }) }));
    await s.page.route(/^https:\/\/eutils\.ncbi\.nlm\.nih\.gov\/entrez\/eutils\/esummary/, r => r.fulfill({ status: 200, headers: CORS, body: JSON.stringify({ result: { '123': { title: 'PubMed Article.', authors: [{ name: 'Silva AB' }, { name: 'Costa C' }], pubdate: '2020 Mar', fulljournalname: 'Rev Med', articleids: [{ idtype: 'doi', value: '10.2222/PM' }], volume: '9', issue: '1', pages: '1-5' } } }) }));
    await mock('www.ebi.ac.uk', { resultList: { result: [{ title: 'Europe PMC Article.', authorString: 'Silva AB, Costa C.', pubYear: '2019', doi: '10.3333/EP', pmid: '999', journalInfo: { journal: { title: 'Rev EPMC' }, volume: '3' }, abstractText: 'EPMC abstract', fullTextUrlList: { fullTextUrl: [{ documentStyle: 'pdf', availability: 'Free', url: 'https://example.org/ep.pdf' }] } }] } });
    await mock('doaj.org', { results: [{ bibjson: { title: 'DOAJ Article', author: [{ name: 'Ana Lima' }], year: '2018', journal: { title: 'Rev DOAJ', volume: '2', number: '4' }, identifier: [{ type: 'doi', id: '10.4444/DJ' }], link: [{ type: 'fulltext', url: 'https://example.org/doaj' }], start_page: '7', end_page: '9' } }] });
    await mock('api.hal.science', { response: { docs: [{ title_s: ['HAL Article'], authFullName_s: ['Jean Dupont'], doiId_s: '10.5555/HAL', producedDateY_i: 2017, journalTitle_s: 'Rev HAL', uri_s: 'https://hal.science/hal-1', fileMain_s: 'https://hal.science/hal-1/file.pdf', docType_s: 'ART' }] } });
    await mock('zenodo.org', { hits: { hits: [{ doi: '10.6666/ZE', metadata: { title: 'Zenodo Article', creators: [{ name: 'Lima, Pedro' }], publication_date: '2016-05-01', description: 'Desc', journal: { title: 'Rev Z' } }, links: { self_html: 'https://zenodo.org/records/1' }, files: [{ key: 'a.pdf', links: { self: 'https://zenodo.org/records/1/files/a.pdf' } }] }] } });
    await mock('api.openaire.eu', { results: [{ mainTitle: 'OpenAIRE Article', authors: [{ fullName: 'Rosa Alves' }], publicationDate: '2015-01-01', pids: [{ scheme: 'doi', value: '10.7777/OP' }], instances: [{ urls: ['https://example.org/op', 'https://example.org/op.pdf'] }], publisher: 'Ed OP' }] });
    await openProject(s.page, 'demo__refs-fontes');
  });
  afterAll(async () => { await s.context.close(); });

  const cases: [string, Record<string, unknown>][] = [
    ['openalex', { title: 'OpenAlex Article', authors: ['Souza, Maria'], year: 2021, venue: 'Rev OA', doi: '10.1111/oa', pdf: 'https://example.org/oa.pdf', volume: '5', issue: '2', pages: '10-20' }],
    ['pubmed', { title: 'PubMed Article', authors: ['Silva, A. B.', 'Costa, C.'], year: 2020, venue: 'Rev Med', doi: '10.2222/pm', volume: '9', pages: '1-5' }],
    ['europepmc', { title: 'Europe PMC Article', authors: ['Silva, A. B.', 'Costa, C.'], year: 2019, venue: 'Rev EPMC', doi: '10.3333/ep', pdf: 'https://example.org/ep.pdf', abstract: 'EPMC abstract' }],
    ['doaj', { title: 'DOAJ Article', authors: ['Lima, Ana'], year: 2018, venue: 'Rev DOAJ', doi: '10.4444/dj', volume: '2', issue: '4', pages: '7-9' }],
    ['hal', { title: 'HAL Article', authors: ['Dupont, Jean'], year: 2017, venue: 'Rev HAL', doi: '10.5555/hal', pdf: 'https://hal.science/hal-1/file.pdf', type: 'journal-article' }],
    ['zenodo', { title: 'Zenodo Article', authors: ['Lima, Pedro'], year: 2016, venue: 'Rev Z', doi: '10.6666/ze', pdf: 'https://zenodo.org/records/1/files/a.pdf' }],
    ['openaire', { title: 'OpenAIRE Article', authors: ['Alves, Rosa'], year: 2015, doi: '10.7777/op', pdf: 'https://example.org/op.pdf', publisher: 'Ed OP' }],
  ];
  for (const [id, expected] of cases) {
    test(`${id}: normalizes the result`, async () => {
      const r = await run(id);
      expect(r.length).toBe(1);
      for (const [k, v] of Object.entries(expected)) expect(r[0][k]).toEqual(v);
    });
  }

  test('BibTeX escapes special characters, strips stray braces and uses the right type', async () => {
    const bib = await s.page.evaluate(() => {
      const R = (window as any).RefSources;
      const base = { authors: ['Silva, Ana'], year: 2024, venue: '', doi: '', url: '', type: '', volume: '', issue: '', pages: '', publisher: '', eprint: '' };
      return [
        R.toBibtex({ ...base, title: 'A & B: 100% {perfect} #1_x', venue: 'Rev', type: 'journal-article', pages: '5 - 9' }, 'k1'),
        R.toBibtex({ ...base, title: 'Preprint', type: 'preprint', eprint: '2401.01234', venue: '' }, 'k2'),
        R.toBibtex({ ...base, title: 'Proceedings', venue: 'Congress', type: 'proceedings-article' }, 'k3'),
        R.toBibtex({ ...base, title: 'Nothing', url: 'https://example.org/x' }, 'k4'),
        [R.baseKey({ ...base, authors: ['Álvarez, José'], title: 'An analysis of data' }), R.uniqueKey({ ...base, title: 'The Deep' }, new Set(['silva2024deep', 'silva2024deepa']))],
      ];
    });
    expect(bib[0]).toContain('title = {{A \\& B: 100\\% perfect \\#1\\_x}}');
    expect(bib[0]).toContain('pages = {5--9}');
    expect(bib[0]).toContain('@article{k1,');
    expect(bib[1]).toContain('@misc{k2,');
    expect(bib[1]).toContain('eprint = {2401.01234}');
    expect(bib[1]).toContain('archivePrefix = {arXiv}');
    expect(bib[2]).toContain('@inproceedings{k3,');
    expect(bib[2]).toContain('booktitle = {Congress}');
    expect(bib[3]).toContain('@misc{k4,');
    expect(bib[3]).toContain('url = {https://example.org/x}');
    expect(bib[4][0]).toBe('alvarez2024analysis');   // no accent and no stop word
    expect(bib[4][1]).toBe('silva2024deepb');       // skips keys already used
  });
});
