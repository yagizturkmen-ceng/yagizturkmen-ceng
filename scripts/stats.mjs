// GitHub istatistik kartlarını üretir (fork'lar dahil, doğru veriler).
// Kullanım: GITHUB_TOKEN=... node scripts/stats.mjs   |   node scripts/stats.mjs --fixture data.json
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';

const USER = 'yagizturkmen-ceng';
const NAME = 'Yağız Türkmen';
// Profilde gösterilen projeler. Fork olanlarda commit ve diller orijinal repodan okunur.
const PROJECTS = ['automotion', 'beytrium-v1.4', 'bitirme_projesi_korteks', 'ingilizce-calisma-PACEORA-'];

const T = { bg: '#1a1b27', border: '#2f334d', title: '#70a5fd', text: '#a9b1d6', accent: '#38bdae', icon: '#bf91f3', muted: '#565f89' };
const LANG_COLORS = {
  'C#': '#9b4f96', TypeScript: '#3178c6', Dart: '#00B4AB', JavaScript: '#f1e05a', 'C++': '#f34b7d', C: '#555555',
  CSS: '#663399', HTML: '#e34c26', Python: '#3572A5', Java: '#b07219', Kotlin: '#A97BFF', Swift: '#F05138',
  CMake: '#DA3434', Dockerfile: '#384d54', Diğer: '#565f89',
};

const token = process.env.GITHUB_TOKEN;
const headers = { Accept: 'application/vnd.github+json', 'User-Agent': USER, ...(token ? { Authorization: `Bearer ${token}` } : {}) };
const api = async (path) => {
  const r = await fetch(path.startsWith('http') ? path : `https://api.github.com${path}`, { headers });
  if (!r.ok) throw new Error(`${r.status} ${path}`);
  return r.json();
};

async function collect() {
  const projects = [];
  for (const name of PROJECTS) {
    const repo = await api(`/repos/${USER}/${name}`);
    const src = repo.fork && repo.parent ? repo.parent.full_name : repo.full_name;
    const languages = await api(`/repos/${src}/languages`);
    let commits = 0;
    for (let page = 1; page <= 30; page++) {
      // ?author= filtresi bazı commit'leri kaçırıyor; hepsini çekip hesaba göre sayıyoruz.
      const c = await api(`/repos/${src}/commits?per_page=100&page=${page}`);
      commits += c.filter((k) => (k.author && k.author.login) === USER).length;
      if (c.length < 100) break;
    }
    const srcRepo = src === repo.full_name ? repo : await api(`/repos/${src}`);
    projects.push({ name, src, language: srcRepo.language || repo.language, languages, commits, stars: srcRepo.stargazers_count });
  }
  const prs = (await api(`/search/issues?q=author:${USER}+type:pr`)).total_count;
  let calendar = null;
  if (token) try {
    const q = `query{user(login:"${USER}"){contributionsCollection{contributionCalendar{totalContributions weeks{contributionDays{contributionCount date}}}}}}`;
    const r = await fetch('https://api.github.com/graphql', { method: 'POST', headers, body: JSON.stringify({ query: q }) }).then((x) => x.json());
    const cal = r.data.user.contributionsCollection.contributionCalendar;
    calendar = { total: cal.totalContributions, weeks: cal.weeks.map((w) => w.contributionDays.reduce((s, d) => s + d.contributionCount, 0)) };
  } catch (e) { console.warn('Katkı takvimi alınamadı:', e.message); }
  return { projects, prs, calendar, updated: new Date().toISOString() };
}

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const card = (w, h, title, body) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="Segoe UI, Ubuntu, Helvetica, Arial, sans-serif">
<rect x="0.5" y="0.5" width="${w - 1}" height="${h - 1}" rx="6" fill="${T.bg}" stroke="${T.border}"/>
<text x="20" y="32" fill="${T.title}" font-size="17" font-weight="600">${esc(title)}</text>
${body}
</svg>
`;

function topN(map, n = 5) {
  const entries = Object.entries(map).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const top = entries.slice(0, n);
  const rest = entries.slice(n).reduce((s, [, v]) => s + v, 0);
  if (rest > 0) top.push(['Diğer', rest]);
  const total = top.reduce((s, [, v]) => s + v, 0);
  return top.map(([k, v]) => ({ k, v, p: (v / total) * 100 }));
}

function donutCard(title, items, unit) {
  const cx = 250, cy = 112, r = 52, sw = 20, C = 2 * Math.PI * r;
  let off = 0;
  const arcs = items.map((it) => {
    const len = (it.p / 100) * C;
    const s = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${LANG_COLORS[it.k] || '#8b949e'}" stroke-width="${sw}" stroke-dasharray="${len.toFixed(2)} ${(C - len).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 ${cx} ${cy})"/>`;
    off += len;
    return s;
  }).join('\n');
  const legend = items.map((it, i) => {
    const y = 62 + i * 21;
    const label = unit ? `${it.k} · ${it.v} ${unit}` : `${it.k} · %${it.p.toFixed(1).replace('.', ',')}`;
    return `<rect x="20" y="${y - 9}" width="10" height="10" rx="2" fill="${LANG_COLORS[it.k] || '#8b949e'}"/><text x="36" y="${y}" fill="${T.text}" font-size="12">${esc(label)}</text>`;
  }).join('\n');
  return card(340, 200, title, `${arcs}\n${legend}`);
}

function profileCard(d) {
  const commits = d.projects.reduce((s, p) => s + p.commits, 0);
  const stars = d.projects.reduce((s, p) => s + p.stars, 0);
  const rows = [
    ['Proje', d.projects.length],
    ['Commit (projelerde)', commits],
    ['Pull request', d.prs],
    ['Yıldız', stars],
    ...(d.calendar ? [['Katkı (son 1 yıl)', d.calendar.total]] : []),
  ];
  const rowSvg = rows.map(([k, v], i) => {
    const y = 66 + i * 24;
    return `<circle cx="26" cy="${y - 4}" r="3.5" fill="${T.icon}"/><text x="38" y="${y}" fill="${T.text}" font-size="13">${esc(k)}</text><text x="230" y="${y}" fill="${T.accent}" font-size="13" font-weight="600" text-anchor="end">${v}</text>`;
  }).join('\n');
  let chart = '';
  if (d.calendar && d.calendar.weeks.length) {
    const w = d.calendar.weeks, x0 = 270, x1 = 680, y0 = 170, y1 = 58;
    const max = Math.max(1, ...w);
    const pts = w.map((v, i) => [x0 + (i / (w.length - 1 || 1)) * (x1 - x0), y0 - (v / max) * (y0 - y1)]);
    const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ');
    chart = `<text x="${x1}" y="32" fill="${T.muted}" font-size="11" text-anchor="end">haftalık katkılar · son 1 yıl</text>
<line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}" stroke="${T.border}"/>
<path d="${line} L${x1},${y0} L${x0},${y0} Z" fill="${T.icon}" fill-opacity="0.18"/>
<path d="${line}" fill="none" stroke="${T.icon}" stroke-width="2" stroke-linejoin="round"/>`;
  }
  const date = new Date(d.updated).toLocaleDateString('tr-TR', { timeZone: 'Europe/Istanbul' });
  return card(700, 200, `${NAME} · GitHub`, `${rowSvg}\n${chart}\n<text x="20" y="188" fill="${T.muted}" font-size="10">Güncellendi: ${date}</text>`);
}

const fixtureIdx = process.argv.indexOf('--fixture');
const data = fixtureIdx > -1 ? JSON.parse(readFileSync(process.argv[fixtureIdx + 1], 'utf8')) : await collect();

const langBytes = {}, langCommits = {};
for (const p of data.projects) {
  for (const [k, v] of Object.entries(p.languages)) langBytes[k] = (langBytes[k] || 0) + v;
  if (p.commits) langCommits[p.language] = (langCommits[p.language] || 0) + p.commits;
}

mkdirSync('stats', { recursive: true });
writeFileSync('stats/profile.svg', profileCard(data));
writeFileSync('stats/languages.svg', donutCard('Dil dağılımı (kod)', topN(langBytes, 5)));
writeFileSync('stats/commit-languages.svg', donutCard('Commit’lere göre diller', topN(langCommits, 5), 'commit'));
writeFileSync('stats/data.json', JSON.stringify(data, null, 2));
console.log('ok', data.projects.map((p) => `${p.name}:${p.commits}`).join(' '));
