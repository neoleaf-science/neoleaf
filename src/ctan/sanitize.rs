use super::*;

pub(super) const MAX_TEXMF_FILE: usize = 20 * 1024 * 1024;
pub(super) const MAX_TEXMF_TOTAL: usize = 100 * 1024 * 1024;
pub(super) const MAX_ZIP_ENTRIES: usize = 6000;
pub(super) const MAX_DOWNLOAD: usize = 100 * 1024 * 1024;

/// Extensions accepted inside extra packages (files that pdfLaTeX, XeLaTeX and LuaLaTeX read).
pub(super) const ALLOWED_EXT: &[&str] = &[
    "sty", "cls", "clo", "ldf", "def", "fd", "cfg", "dfu", "bbx", "cbx", "lbx", "sto", "ltx",
    "rtx", "bst", "tex", "otf", "ttf", "ttc", "pfb", "pfa", "afm", "tfm", "vf", "map", "enc",
    "woff", "woff2", "pdf", "png", "jpg", "jpeg",
];

/// Images (e.g. the beamer icons, `beamericonbook.pdf`) only count inside `tex/` of a TDS tree; in ordinary zips
/// the PDFs are manuals.
pub(super) fn is_image_ext(ext: &str) -> bool {
    matches!(ext, "pdf" | "png" | "jpg" | "jpeg")
}

pub(super) fn ext_of(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(_, e)| e.to_ascii_lowercase())
        .unwrap_or_default()
}

pub(super) fn safe_basename(name: &str) -> Option<String> {
    let base = name.rsplit(['/', '\\']).next()?;
    if base.is_empty()
        || base.starts_with('.')
        || base.len() > 100
        || !base
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '_' | '-' | '+'))
    {
        return None;
    }
    Some(base.to_string())
}

/// Picks, among a package's files, only those pdfLaTeX reads (flattened by name).
pub(super) struct Collector {
    /// Files of a TDS tree (`tex/` folder at the root): we only look inside it.
    is_tds: bool,
    files: Vec<(String, Vec<u8>)>,
    seen: std::collections::HashSet<String>,
    total: usize,
}

impl Collector {
    pub(super) fn new(is_tds: bool) -> Self {
        Collector {
            is_tds,
            files: Vec::new(),
            seen: Default::default(),
            total: 0,
        }
    }

    pub(super) fn offer<R: Read>(
        &mut self,
        raw_path: &str,
        size: u64,
        reader: R,
    ) -> Result<(), String> {
        let path = raw_path.replace('\\', "/");
        if path.starts_with('/')
            || path
                .split('/')
                .any(|seg| seg == ".." || seg.starts_with('.'))
        {
            return Ok(());
        }
        // TDS tree: classes and packages live in `tex/`; bibliography styles (.bst) in `bibtex/bst/`; fonts in `fonts/`
        if self.is_tds
            && !path.starts_with("tex/")
            && !(path.starts_with("bibtex/bst/") && path.ends_with(".bst"))
            && !path.starts_with("fonts/")
        {
            return Ok(());
        }
        // In ordinary zips, ignore the package's documentation, examples and sources.
        let lower = path.to_ascii_lowercase();
        if !self.is_tds
            && lower.split('/').any(|seg| {
                matches!(
                    seg,
                    "doc" | "docs" | "example" | "examples" | "source" | "test" | "tests"
                )
            })
        {
            return Ok(());
        }
        let Some(base) = safe_basename(&path) else {
            return Ok(());
        };
        let ext = ext_of(&base);
        if !ALLOWED_EXT.contains(&ext.as_str()) {
            return Ok(());
        }
        if is_image_ext(&ext) && !(self.is_tds && path.starts_with("tex/")) {
            return Ok(());
        }
        // `.tex` only counts inside `tex/` (ordinary zips ship examples and documentation as .tex)
        if ext == "tex" && !self.is_tds {
            return Ok(());
        }
        if size as usize > MAX_TEXMF_FILE || !self.seen.insert(base.clone()) {
            return Ok(());
        }
        let mut buf = Vec::new();
        if reader
            .take(MAX_TEXMF_FILE as u64 + 1)
            .read_to_end(&mut buf)
            .is_err()
            || buf.len() > MAX_TEXMF_FILE
        {
            return Ok(());
        }
        self.total += buf.len();
        if self.total > MAX_TEXMF_TOTAL {
            return Err("Package is too large".to_string());
        }
        self.files.push((base, buf));
        Ok(())
    }

    pub(super) fn finish(mut self) -> Vec<(String, Vec<u8>)> {
        self.files.sort_by(|a, b| a.0.cmp(&b.0));
        self.files
    }
}

/// Filters a zip (of a LaTeX package) keeping only files pdfLaTeX reads, flattened by name.
pub fn sanitize_zip(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut zip =
        zip::ZipArchive::new(Cursor::new(bytes)).map_err(|_| "Invalid zip file".to_string())?;
    if zip.len() > MAX_ZIP_ENTRIES {
        return Err("Zip has too many files".to_string());
    }
    // "TDS" zips have a `tex/` folder at the root.
    let is_tds = (0..zip.len()).any(|i| {
        zip.by_index(i)
            .ok()
            .and_then(|e| e.name().ok().map(|n| n.starts_with("tex/")))
            .unwrap_or(false)
    });
    let mut c = Collector::new(is_tds);
    for i in 0..zip.len() {
        let Ok(entry) = zip.by_index(i) else { continue };
        if entry.is_dir() {
            continue;
        }
        // an entry whose name cannot be decoded is skipped (never accepted)
        let Ok(name) = entry.name().map(|n| n.to_string()) else {
            continue;
        };
        let size = entry.size();
        c.offer(&name, size, entry)?;
    }
    Ok(c.finish())
}

/// Writer that refuses to go past a limit (protects against .xz "bomb" files).
pub(super) struct LimitedVec {
    pub(super) buf: Vec<u8>,
    pub(super) limit: usize,
}

impl Write for LimitedVec {
    fn write(&mut self, data: &[u8]) -> std::io::Result<usize> {
        if self.buf.len() + data.len() > self.limit {
            return Err(std::io::Error::other("decompressed data is too large"));
        }
        self.buf.extend_from_slice(data);
        Ok(data.len())
    }

    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

/// Filters a TeX Live package (`.tar.xz` with a TDS tree: `tex/latex/<package>/...`).
pub fn sanitize_tar_xz(bytes: &[u8]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out = LimitedVec {
        buf: Vec::new(),
        limit: 150 * 1024 * 1024,
    };
    lzma_rs::xz_decompress(&mut Cursor::new(bytes), &mut out)
        .map_err(|_| "Invalid .tar.xz file".to_string())?;
    let mut archive = tar::Archive::new(Cursor::new(out.buf));
    let mut c = Collector::new(true);
    for entry in archive
        .entries()
        .map_err(|_| "Invalid tar file".to_string())?
    {
        let Ok(entry) = entry else { continue };
        if !entry.header().entry_type().is_file() {
            continue;
        }
        let Ok(path) = entry.path().map(|p| p.to_string_lossy().to_string()) else {
            continue;
        };
        // some packages come as `tex/...`, others as `texmf-dist/tex/...`
        let path = path
            .strip_prefix("texmf-dist/")
            .unwrap_or(&path)
            .to_string();
        let size = entry.size();
        c.offer(&path, size, entry)?;
    }
    Ok(c.finish())
}

#[cfg(test)]
pub fn pack_zip(files: &[(String, Vec<u8>)]) -> Result<Vec<u8>, String> {
    let mut out = Cursor::new(Vec::new());
    {
        let mut w = zip::ZipWriter::new(&mut out);
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in files {
            w.start_file(name, opts).map_err(|e| e.to_string())?;
            w.write_all(data).map_err(|e| e.to_string())?;
        }
        w.finish().map_err(|e| e.to_string())?;
    }
    Ok(out.into_inner())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_zip(entries: &[(&str, &str)]) -> Vec<u8> {
        pack_zip(
            &entries
                .iter()
                .map(|(n, c)| (n.to_string(), c.as_bytes().to_vec()))
                .collect::<Vec<_>>(),
        )
        .unwrap()
    }

    #[test]
    fn plain_zip_filters_unwanted_files() {
        let z = make_zip(&[
            ("enumitem/enumitem.sty", "% sty"),
            ("enumitem/enumitem.dtx", "dtx"),
            ("enumitem/enumitem.pdf", "pdf"),
            ("enumitem/doc/example.sty", "no"),
            ("enumitem/example.tex", "no"),
            ("../outside.sty", "no"),
            ("enumitem/.hidden.sty", "no"),
            ("enumitem/com space.sty", "no"),
        ]);
        let files = sanitize_zip(&z).unwrap();
        let names: Vec<_> = files.iter().map(|f| f.0.as_str()).collect();
        assert_eq!(names, vec!["enumitem.sty"]);
    }

    #[test]
    fn tds_zip_uses_only_tex() {
        let z = make_zip(&[
            ("tex/latex/abntex2/abntex2.cls", "cls"),
            ("tex/latex/abntex2/abntex2-alf.bbx", "bbx"),
            ("tex/latex/abntex2/example.tex", "tex"),
            ("tex/latex/beamer/beamericonbook.pdf", "pdf"),
            ("doc/latex/abntex2/manual.pdf", "pdf"),
            ("bibtex/bst/abntex2/abntex2-alf.bst", "bst"),
        ]);
        let mut names: Vec<String> = sanitize_zip(&z).unwrap().into_iter().map(|f| f.0).collect();
        names.sort();
        assert_eq!(
            names,
            vec![
                "abntex2-alf.bbx",
                "abntex2-alf.bst",
                "abntex2.cls",
                "beamericonbook.pdf",
                "example.tex"
            ],
            "the .bst style is kept (BibTeX) and so are images under tex/ (beamer icons), but not the manuals in doc/"
        );
    }

    #[test]
    fn texlive_tar_xz() {
        let mut tar_bytes = Vec::new();
        {
            let mut b = tar::Builder::new(&mut tar_bytes);
            for (path, data) in [
                ("tex/generic/babel-portuges/portuges.ldf", "% ldf"),
                ("tex/generic/babel-portuges/brazilian.ldf", "% br"),
                ("bibtex/bst/natbib/plainnat.bst", "% bst"),
                ("bibtex/bib/natbib/example.bib", "% no"),
                (
                    "texmf-dist/tex/latex/hyperxmp/hyperxmp.sty",
                    "% sty with texmf-dist prefix",
                ),
                (
                    "texmf-dist/scripts/hyperxmp/hyperxmp-add-bytecount.pl",
                    "perl",
                ),
                ("tlpkg/tlpobj/babel-portuges.tlpobj", "meta"),
                ("doc/generic/babel-portuges/manual.pdf", "pdf"),
                ("tex/latex/x/../../../etc/evil.sty", "no"),
            ] {
                let mut h = tar::Header::new_gnu();
                h.set_size(data.len() as u64);
                h.set_mode(0o644);
                h.set_cksum();
                // set_path rejects ".."; write the raw name to simulate a malicious tar
                let raw = path.as_bytes();
                h.as_old_mut().name[..raw.len()].copy_from_slice(raw);
                h.set_cksum();
                b.append(&h, data.as_bytes()).unwrap();
            }
            b.finish().unwrap();
        }
        let mut xz = Vec::new();
        lzma_rs::xz_compress(&mut Cursor::new(tar_bytes), &mut xz).unwrap();
        let names: Vec<String> = sanitize_tar_xz(&xz)
            .unwrap()
            .into_iter()
            .map(|f| f.0)
            .collect();
        assert_eq!(
            names,
            vec![
                "brazilian.ldf",
                "hyperxmp.sty",
                "plainnat.bst",
                "portuges.ldf"
            ]
        );
        assert!(sanitize_tar_xz(b"junk").is_err());
    }

    #[test]
    fn invalid_zip_and_bad_name() {
        assert!(sanitize_zip(b"this is not a zip").is_err());
        assert_eq!(
            safe_basename("../../etc/passwd").as_deref(),
            Some("passwd"),
            "only the base name is used; the extension is rejected later"
        );
        assert!(safe_basename("..").is_none() && safe_basename(".bashrc").is_none());
        assert!(safe_basename("a b.sty").is_none());
        assert_eq!(safe_basename("dir/x.sty").as_deref(), Some("x.sty"));
        assert!(valid_pkg_name("babel-portuges") && !valid_pkg_name("../x") && !valid_pkg_name(""));
    }
}
