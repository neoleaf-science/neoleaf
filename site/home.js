        (function() {
            // Typing animation of the multilingual \begin{...}
            var WORDS_BY_LANG = {
                pt: ["artigos", "teses", "relatórios", "apresentações", "pesquisa livre"],
                en: ["papers", "theses", "reports", "presentations", "free research"],
                es: ["artículos", "tesis", "informes", "presentaciones", "investigación libre"],
                zh: ["学术论文", "学位论文", "报告", "演示文稿", "自由研究"],
                cs: ["články", "diplomové práce", "zprávy", "prezentace", "volný výzkum"],
                fr: ["articles", "thèses", "rapports", "présentations", "recherche libre"],
                de: ["Artikel", "Abschlussarbeiten", "Berichte", "Präsentationen", "freie Forschung"],
                sv: ["artiklar", "avhandlingar", "rapporter", "presentationer", "fri forskning"],
                tr: ["makaleler", "tezler", "raporlar", "sunumlar", "özgür araştırma"],
                it: ["articoli", "tesi", "relazioni", "presentazioni", "ricerca libera"],
                nb: ["artikler", "avhandlinger", "rapporter", "presentasjoner", "fri forskning"],
                ru: ["статьи", "диссертации", "отчёты", "презентации", "свободные исследования"],
                da: ["artikler", "afhandlinger", "rapporter", "præsentationer", "fri forskning"],
                ko: ["논문", "학위논문", "보고서", "발표 자료", "자유 연구"],
                ja: ["論文", "学位論文", "報告書", "プレゼンテーション", "自由な研究"]
            };
            function getLang() {
                try {
                    var l = localStorage.getItem('ld-lang');
                    if (l && WORDS_BY_LANG[l]) return l;
                } catch(_) {}
                var docLang = (document.documentElement.lang || 'en').substring(0, 2);
                return WORDS_BY_LANG[docLang] ? docLang : 'en';
            }
            var currentLang = getLang();
            var words = WORDS_BY_LANG[currentLang] || WORDS_BY_LANG.en;
            var wordIdx = 0;
            var charIdx = 0;
            var isDeleting = false;
            var animElem = document.getElementById('home-animation-text');

            window.addEventListener('ld-lang-change', function(e) {
                var newLang = (e && e.detail && e.detail.lang) || getLang();
                if (WORDS_BY_LANG[newLang]) {
                    words = WORDS_BY_LANG[newLang];
                    wordIdx = 0;
                    charIdx = 0;
                    isDeleting = false;
                }
            });

            function typeLoop() {
                if (!animElem) return;
                var currentWord = words[wordIdx];

                if (isDeleting) {
                    animElem.textContent = currentWord.substring(0, charIdx - 1);
                    charIdx--;
                } else {
                    animElem.textContent = currentWord.substring(0, charIdx + 1);
                    charIdx++;
                }

                var delay = isDeleting ? 45 : 85;

                if (!isDeleting && charIdx === currentWord.length) {
                    delay = 1900; // pause with the complete word
                    isDeleting = true;
                } else if (isDeleting && charIdx === 0) {
                    isDeleting = false;
                    wordIdx = (wordIdx + 1) % words.length;
                    delay = 350; // pause before the next word
                }

                setTimeout(typeLoop, delay);
            }

            if (document.readyState === 'loading') {
                document.addEventListener('DOMContentLoaded', typeLoop);
            } else {
                typeLoop();
            }

            // Mobile menu toggle
            var toggleBtn = document.getElementById('nl-nav-toggle');
            var menuCollapse = document.getElementById('nl-nav-collapse');
            if (toggleBtn && menuCollapse) {
                toggleBtn.addEventListener('click', function() {
                    menuCollapse.classList.toggle('active');
                });
            }
        })();
        (function () {
            // outside the official domains (development), the command points to the server itself
            const t = document.getElementById('install-cmd-text');
            if (t && !/(^|\.)neoleaf\.(science|duckdns\.org)$/.test(location.hostname)) t.textContent = 'curl -fsSL ' + location.origin + '/install.sh | sh';
        })();
        function copyInstallCmd(btn) {
            const text = document.getElementById('install-cmd-text').textContent.trim();
            const done = () => { const o = btn.textContent; btn.textContent = 'Copied!'; setTimeout(() => { btn.textContent = o; }, 2000); };
            if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done);
        }

        // Screenshots carousel in the showcase window: arrows, dots, the keyboard (left and right), a swipe, or a click on the picture. It also turns by itself every few
        // seconds, until the person moves through the screens (from then on it is theirs), hovers or focuses it, or presses pause; it never starts for people who ask
        // for less motion, and it waits while the tab is hidden or the carousel is out of view.
        (function () {
            var root = document.getElementById('nl-shots');
            if (!root) return;
            var figs = Array.prototype.slice.call(root.querySelectorAll('.nl-shot'));
            var dots = Array.prototype.slice.call(root.querySelectorAll('.nl-shot-dot'));
            var stage = root.querySelector('.nl-shots-stage');
            var playBtn = document.getElementById('nl-shot-play');
            var EVERY = parseInt(root.getAttribute('data-interval'), 10) || 6500;
            var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
            var cur = 0, playing = !reduce, held = false, visible = true, timer = null;

            function paint() {
                // while it turns by itself nothing is announced; once it is the person's, a screen reader hears each new caption
                stage.setAttribute('aria-live', playing ? 'off' : 'polite');
                playBtn.setAttribute('aria-pressed', playing ? 'false' : 'true');
                playBtn.setAttribute('aria-label', playing ? 'Pause the slideshow' : 'Play the slideshow');
                playBtn.textContent = playing ? '\u275A\u275A' : '\u25B6';
            }
            function schedule() {
                clearInterval(timer);
                timer = null;
                if (playing && !held && visible && !document.hidden) timer = setInterval(function () { show(cur + 1); }, EVERY);
            }
            function show(i) {
                cur = (i + figs.length) % figs.length;
                figs.forEach(function (f, k) {
                    f.classList.toggle('is-active', k === cur);
                    f.setAttribute('aria-hidden', k === cur ? 'false' : 'true');
                });
                dots.forEach(function (d, k) {
                    d.classList.toggle('is-active', k === cur);
                    d.setAttribute('aria-selected', k === cur ? 'true' : 'false');
                    d.setAttribute('aria-label', 'Screen ' + (k + 1) + ' of ' + figs.length);
                });
                // the next picture is fetched ahead of time
                var nxt = figs[(cur + 1) % figs.length].querySelector('img');
                if (nxt && nxt.getAttribute('loading') === 'lazy') nxt.setAttribute('loading', 'eager');
            }
            // the person moves through the screens: the slideshow stops for good
            function go(i) { playing = false; paint(); schedule(); show(i); }

            document.getElementById('nl-shot-prev').addEventListener('click', function () { go(cur - 1); });
            document.getElementById('nl-shot-next').addEventListener('click', function () { go(cur + 1); });
            dots.forEach(function (d) { d.addEventListener('click', function () { go(parseInt(d.getAttribute('data-i'), 10)); }); });
            figs.forEach(function (f) { f.querySelector('.nl-shot-img').addEventListener('click', function () { go(cur + 1); }); });
            playBtn.addEventListener('click', function () { playing = !playing; paint(); schedule(); });
            root.addEventListener('keydown', function (e) {
                if (e.key === 'ArrowLeft') { go(cur - 1); e.preventDefault(); }
                else if (e.key === 'ArrowRight') { go(cur + 1); e.preventDefault(); }
            });
            var x0 = null;
            stage.addEventListener('touchstart', function (e) { x0 = e.touches[0].clientX; }, { passive: true });
            stage.addEventListener('touchend', function (e) {
                if (x0 === null) return;
                var dx = e.changedTouches[0].clientX - x0;
                x0 = null;
                if (Math.abs(dx) > 40) go(cur + (dx < 0 ? 1 : -1));
            }, { passive: true });
            // it waits while the mouse is on it or the focus is inside
            root.addEventListener('mouseenter', function () { held = true; schedule(); });
            root.addEventListener('mouseleave', function () { held = false; schedule(); });
            root.addEventListener('focusin', function () { held = true; schedule(); });
            root.addEventListener('focusout', function () { held = false; schedule(); });
            document.addEventListener('visibilitychange', schedule);
            if ('IntersectionObserver' in window) new IntersectionObserver(function (es) { visible = es[0].isIntersecting; schedule(); }).observe(root);
            show(0);
            paint();
            schedule();
        })();
