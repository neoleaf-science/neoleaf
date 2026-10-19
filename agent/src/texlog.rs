//! What a TeX or BibTeX log says went wrong.

/// Files the log says it could not find (e.g. xstring.sty), in order and without repeats
pub(crate) fn missing_files(log: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in log.lines() {
        let name = line
            .split("! LaTeX Error: File `")
            .nth(1)
            .and_then(|r| r.split('\'').next())
            .or_else(|| {
                line.split("! I can't find file `")
                    .nth(1)
                    .and_then(|r| r.split('\'').next())
                    .filter(|n| n.contains('.'))
            })
            .or_else(|| {
                line.split("Package ")
                    .nth(1)
                    .filter(|_| line.contains("File `"))
                    .and_then(|_| line.split("File `").nth(1))
                    .and_then(|r| r.split('\'').next())
            });
        // font without metrics: "Font OT1/pcr/m/n/10=pcrr7t at 10.0pt not loadable: Metric (TFM) file not found" -> pcrr7t.tfm
        let tfm = line
            .contains("not loadable: Metric (TFM) file not found")
            .then(|| {
                let after = line.split('=').nth(1)?;
                let n = after.split(" at ").next()?.trim();
                (!n.is_empty()
                    && n.bytes()
                        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_')))
                .then(|| format!("{n}.tfm"))
            })
            .flatten();
        if let Some(t) = tfm {
            if !out.contains(&t) {
                out.push(t);
            }
            continue;
        }
        // babel language without the .ldf installed (e.g. an option coming from the class, like abntex2 with `spanish`): "Package babel Error: Unknown option 'spanish'."
        if line.contains("Package babel Error: Unknown option") {
            let lang: String = line
                .split("option")
                .nth(1)
                .unwrap_or("")
                .trim_start()
                .trim_start_matches(['\'', '`', '\u{2018}'])
                .chars()
                .take_while(|c| c.is_ascii_alphanumeric() || *c == '-')
                .collect();
            let f = format!("{lang}.ldf");
            if !lang.is_empty() && !out.contains(&f) {
                out.push(f);
            }
            continue;
        }
        if let Some(n) = name {
            let n = n.trim().trim_end_matches('\'');
            let n = if n.contains('.') {
                n.to_string()
            } else {
                format!("{n}.sty")
            };
            // files TeX itself generates (.out, .aux, .toc...) do not exist before the first pass: they are not "missing"
            let ext = n.rsplit('.').next().unwrap_or("").to_ascii_lowercase();
            if matches!(
                ext.as_str(),
                "out"
                    | "aux"
                    | "toc"
                    | "lof"
                    | "lot"
                    | "bbl"
                    | "blg"
                    | "ind"
                    | "idx"
                    | "ilg"
                    | "glo"
                    | "gls"
                    | "nav"
                    | "snm"
                    | "vrb"
                    | "brf"
                    | "bcf"
                    | "fls"
                    | "xdv"
                    | "thm"
                    | "loa"
                    | "lol"
            ) {
                continue;
            }
            if !out.contains(&n)
                && n.len() < 80
                && n.bytes()
                    .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'.' | b'-' | b'_'))
            {
                out.push(n);
            }
        }
    }
    out
}

/// BibTeX errors that make latexmk give up (faulty .bst style, .bib or .bst that does not open).
pub(crate) fn bibtex_errors(log: &str) -> Vec<String> {
    let mut out: Vec<String> = Vec::new();
    for line in log.lines() {
        let l = line.trim();
        let hit = l.contains("---line ") && l.contains(" of file ")
            || l.starts_with("I couldn't open database file")
            || l.starts_with("I couldn't open style file")
            || l.starts_with("I couldn't open file name");
        if hit && !out.iter().any(|x| x == l) {
            out.push(l.to_string());
        }
    }
    out.truncate(4);
    out
}

#[cfg(test)]
mod tests {
    use super::missing_files;

    #[test]
    fn ignores_metafont_noise_but_keeps_real_files() {
        let log = "! I can't find file `FontAwesome'.\n! LaTeX Error: File `manyfoot.sty' not found.\n! I can't find file `figura.png'.\n";
        assert_eq!(missing_files(log), vec!["manyfoot.sty", "figura.png"]);
    }

    #[test]
    fn finds_babel_languages_that_are_not_installed() {
        let log = "/x/babel.sty:4330: Package babel Error: Unknown option 'spanish'.\n(babel)   Suggested actions:\n/x/babel.sty:4330: Package babel Error: Unknown option `ngerman'.\n";
        assert_eq!(missing_files(log), vec!["spanish.ldf", "ngerman.ldf"]);
    }

    #[test]
    fn finds_fonts_without_metrics() {
        let log = "./main.tex:31: Font OT1/pcr/m/n/10=pcrr7t at 10.0pt not loadable: Metric (TFM) file not found.\n! Font \\tenrm=ec-lmr10 at 10pt not loadable: Metric (TFM) file not found.\n./main.tex:31: Font OT1/pcr/m/n/10=pcrr7t at 10.0pt not loadable: Metric (TFM) file not found.\n";
        assert_eq!(missing_files(log), vec!["pcrr7t.tfm", "ec-lmr10.tfm"]);
    }
}

#[cfg(test)]
mod bibtex_tests {
    use super::{bibtex_errors, missing_files};

    #[test]
    fn finds_bibtex_failures() {
        let log = "This is BibTeX\nif$Seleção is an unknown function---line 201 of file abntex2-alf.bst\nI couldn't open database file x.bib\nok\nif$Seleção is an unknown function---line 201 of file abntex2-alf.bst\n";
        let e = bibtex_errors(log);
        assert_eq!(e.len(), 2);
        assert!(e[0].contains("abntex2-alf.bst") && e[1].contains("x.bib"));
        assert!(bibtex_errors("all good").is_empty());
    }

    #[test]
    fn generated_files_are_not_missing() {
        assert!(missing_files("! LaTeX Error: File `template-qual.out' not found.\n! LaTeX Error: File `x.toc' not found.").is_empty());
        assert_eq!(
            missing_files("! LaTeX Error: File `x.sty' not found."),
            vec!["x.sty"]
        );
    }
}
