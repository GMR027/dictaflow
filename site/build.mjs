// Genera la web estática: node site/build.mjs  →  site/dist/{index.html, es/index.html, ...}
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { DOWNLOADS, REPO, T, featureIcons } from './content.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const root = join(here, '..')
const dist = join(here, 'dist')
const version = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version

// SHA256SUMS.txt lo genera la compilación de la release ("hash  archivo")
const sumsFile = process.env.CHECKSUMS || join(root, 'release', 'SHA256SUMS.txt')
const sums = {}
if (existsSync(sumsFile)) for (const l of readFileSync(sumsFile, 'utf8').split('\n')) { const [h, f] = l.trim().split(/\s+/); if (h && f) sums[f.replace(/^\*/, '')] = h }

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const dl = (f) => `${REPO}/releases/latest/download/${f}`

function picture(prefix, name, alt, up) {
  const p = `${up}img/${name}`
  return `<picture><source media="(prefers-color-scheme: dark)" srcset="${p}-dark.png"><img src="${p}-light.png" alt="${esc(alt)}" loading="lazy" width="1180" height="760"></picture>`
}

function page(t) {
  const up = t.lang === 'es' ? '../' : ''
  const url = `${up}`
  const distroCards = DOWNLOADS.map((d) => {
    const [name, kind] = t.distros[d.id]
    const sum = sums[d.file]
    return `<article class="card distro">
      <h3>${esc(name)}</h3><p class="muted">${esc(kind)}</p>
      <a class="btn primary" href="${dl(d.file)}" rel="noopener">${t.download} <span class="file">${d.file}</span></a>
      <div class="cmdrow"><pre><code>${esc(d.cmd)}</code></pre><button class="copy" data-copied="${t.copied}" data-label="${t.copy}" aria-label="${t.copy}">${t.copy}</button></div>
      ${sum ? `<p class="sum"><span class="muted">SHA-256</span> <code>${sum}</code></p>` : ''}
    </article>`
  }).join('\n')
  const lang = (l) => (l.lang === t.lang ? '' : `<link rel="alternate" hreflang="${l.lang}" href="${l.lang === 'es' ? 'es/' : './'}">`)

  return `<!doctype html>
<html lang="${t.htmlLang}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(t.title)}</title>
<meta name="description" content="${esc(t.description)}">
<meta property="og:title" content="${esc(t.title)}"><meta property="og:description" content="${esc(t.description)}">
<meta property="og:image" content="${up}img/dictado-dark.png"><meta property="og:type" content="website">
<link rel="icon" type="image/svg+xml" href="${up}img/icon.svg"><link rel="alternate" hreflang="en" href="${t.lang === 'en' ? './' : '../'}"><link rel="alternate" hreflang="es" href="${t.lang === 'es' ? './' : 'es/'}">
<link rel="stylesheet" href="${up}style.css">
${t.lang === 'es' ? '' : `<script>try{if(/^es/i.test(navigator.language)&&!/lang=en/.test(location.search)&&!document.referrer.includes(location.host))location.replace('es/')}catch(e){}</script>`}
</head>
<body>
<header class="top"><div class="wrap">
  <a class="brand" href="${url || './'}"><img src="${up}img/icon.svg" alt="" width="30" height="30">DictaFlow</a>
  <nav aria-label="Main">
    <a href="#features">${t.nav.features}</a><a href="#shots">${t.nav.shots}</a><a href="#privacy">${t.nav.privacy}</a><a href="#install">${t.nav.install}</a><a href="#faq">${t.nav.faq}</a>
    <a class="lang" href="${t.other.href}" hreflang="${t.lang === 'en' ? 'es' : 'en'}">${t.other.label}</a>
    <a href="${REPO}" rel="noopener">GitHub</a>
  </nav>
</div></header>

<main>
<section class="hero wrap">
  <div class="hero-text">
    <p class="chip">v${version} · beta</p>
    <h1>${esc(t.hero.h1)}</h1>
    <p class="lead">${esc(t.hero.sub)}</p>
    <div class="cta"><a class="btn primary big" href="#install">${t.hero.cta}</a><a class="btn big" href="${REPO}" rel="noopener">${t.hero.repo}</a></div>
    <p class="muted">${esc(t.hero.note)}</p>
  </div>
  <div class="hero-shot">${picture('', 'dictado', t.shotCaptions.dictado, up)}</div>
</section>

<section id="features" class="wrap">
  <h2>${esc(t.featuresTitle)}</h2>
  <div class="grid">${t.features.map(([h, p], i) => `<article class="card"><span class="ico" aria-hidden="true">${featureIcons[i]}</span><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('')}</div>
</section>

<section id="shots" class="wrap">
  <h2>${esc(t.shotsTitle)}</h2><p class="muted">${esc(t.shotsSub)}</p>
  <div class="shots">${['prompts', 'reuniones', 'audio'].map((n) => `<figure>${picture('', n, t.shotCaptions[n], up)}<figcaption>${esc(t.shotCaptions[n])}</figcaption></figure>`).join('')}</div>
</section>

<section id="privacy" class="wrap">
  <h2>${esc(t.privacyTitle)}</h2>
  <div class="grid two">${t.privacy.map(([h, p]) => `<article class="card"><h3>${esc(h)}</h3><p>${esc(p)}</p></article>`).join('')}</div>
</section>

<section id="install" class="wrap">
  <h2>${esc(t.installTitle)}</h2><p class="muted">${esc(t.installSub)}</p>
  <div class="grid">${distroCards}</div>
  <article class="card verify"><h3>${esc(t.verifyTitle)}</h3><p>${esc(t.verify)}</p>
    <pre><code>sha256sum -c SHA256SUMS.txt</code></pre>
    <p><a href="${REPO}/releases/latest/download/SHA256SUMS.txt" rel="noopener">${esc(t.sums)}</a></p></article>
  <div class="grid two">
    <article class="card"><h3>${esc(t.reqTitle)}</h3><ul>${t.req.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></article>
    <article class="card"><h3>${esc(t.limitsTitle)}</h3><ul>${t.limits.map((r) => `<li>${esc(r)}</li>`).join('')}</ul></article>
  </div>
</section>

<section id="faq" class="wrap narrow">
  <h2>${esc(t.faqTitle)}</h2>
  ${t.faq.map(([q, a]) => `<details class="card"><summary>${esc(q)}</summary><p>${esc(a)}</p></details>`).join('')}
</section>
</main>

<footer><div class="wrap">
  <p>${t.footer.license} · <a href="${REPO}">GitHub</a> · <a href="${REPO}/blob/main/THIRD-PARTY.md">${t.footer.third}</a></p>
  <p class="muted">${esc(t.footer.notAffiliated)}</p>
</div></footer>
<script>
document.querySelectorAll('.copy').forEach(function(b){b.addEventListener('click',function(){
  var code=b.parentNode.querySelector('code').textContent;
  (navigator.clipboard?navigator.clipboard.writeText(code):Promise.reject()).then(function(){b.textContent=b.dataset.copied;setTimeout(function(){b.textContent=b.dataset.label},1500)}).catch(function(){})
})})
</script>
</body>
</html>
`
}

rmSync(dist, { recursive: true, force: true })
mkdirSync(join(dist, 'es'), { recursive: true })
writeFileSync(join(dist, 'index.html'), page(T.en))
writeFileSync(join(dist, 'es', 'index.html'), page(T.es))
copyFileSync(join(here, 'style.css'), join(dist, 'style.css'))
cpSync(join(here, 'img'), join(dist, 'img'), { recursive: true })
writeFileSync(join(dist, '.nojekyll'), '')
writeFileSync(join(dist, 'robots.txt'), 'User-agent: *\nAllow: /\n')
console.log(`site built: v${version}, ${Object.keys(sums).length} checksums → ${dist}`)
