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
