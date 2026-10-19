use super::*;

// ------------------------------------------------------------------ file -> package index (TeX Live)

/// `containerchecksum` of each package in `texlive.tlpdb`.
pub(super) fn parse_tlpdb_sums(text: &str) -> HashMap<String, String> {
    let mut sums = HashMap::new();
    let mut pkg = "";
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("name ") {
            pkg = name.trim();
        } else if let Some(sum) = line.strip_prefix("containerchecksum ")
            && !pkg.is_empty()
        {
            sums.insert(pkg.to_string(), sum.trim().to_ascii_lowercase());
        }
    }
    sums
}

/// Reads `texlive.tlpdb` and builds the map "LaTeX file name" -> "TeX Live package that contains it".
pub(super) fn parse_tlpdb(text: &str) -> HashMap<String, String> {
    let mut all: HashMap<String, Vec<String>> = HashMap::new();
    let mut pkg = "";
    let mut in_run = false;
    for line in text.lines() {
        if let Some(name) = line.strip_prefix("name ") {
            pkg = name.trim();
            in_run = false;
        } else if line.starts_with("runfiles ") {
            in_run = true;
        } else if line.starts_with(' ') && in_run {
            let path = line.trim();
            // "relocatable" packages use RELOC/ instead of texmf-dist/
            let is_style = path.ends_with(".bst")
                && (path.starts_with("texmf-dist/bibtex/bst/")
                    || path.starts_with("RELOC/bibtex/bst/"));
            let is_font = path.starts_with("texmf-dist/fonts/") || path.starts_with("RELOC/fonts/");
            if !(path.starts_with("texmf-dist/tex/")
                || path.starts_with("RELOC/tex/")
                || is_style
                || is_font)
            {
                continue;
            }
            let Some(base) = path.rsplit('/').next() else {
                continue;
            };
            if ALLOWED_EXT.contains(&ext_of(base).as_str()) && !pkg.contains('.') {
                all.entry(base.to_string())
                    .or_default()
                    .push(pkg.to_string());
            }
        } else if !line.starts_with(' ') {
            in_run = false;
        }
    }
    all.into_iter()
        .filter_map(|(file, mut pkgs)| {
            // prefer the "real" package over development versions (-dev) and collections
            pkgs.sort_by_key(|p| (p.ends_with("-dev") || p.starts_with("collection-"), p.len()));
            pkgs.into_iter().next().map(|p| (file, p))
        })
        .collect()
}

/// TeX Live repository frozen at the era of the browser compiler (TeX Live 2023, "tlnet-final").
pub(super) fn historic_tlnet() -> String {
    std::env::var("TLNET_HISTORIC_URL").unwrap_or_else(|_| {
        "https://ftp.math.utah.edu/pub/tex/historic/systems/texlive/2023/tlnet-final".to_string()
    })
}

pub(super) fn tlpdb_urls() -> Vec<String> {
    let mirror =
        std::env::var("CTAN_MIRROR_URL").unwrap_or_else(|_| "https://mirrors.ctan.org".to_string());
    match std::env::var("TLPDB_URL") {
        Ok(u) => vec![u],
        Err(_) => vec![
            format!("{}/tlpkg/texlive.tlpdb.xz", historic_tlnet()),
            format!("{mirror}/systems/texlive/tlnet/tlpkg/texlive.tlpdb.xz"),
        ],
    }
}

// ---- on-disk index
//
// The "file -> package" map (~100 thousand lines) used ~45 MB of RAM all the time. Now it lives in files of fixed-size records,
// sorted, queried by binary search with small reads (the system page cache keeps what is used and
// gives it back by itself if RAM gets tight). Since TeX Live 2023 is frozen, the file is built once and reused across startups.

pub(super) const IDX_VERSION: &str = "v1";
pub(super) const KEY_W: usize = 64; // file name (longer ones do not exist in TeX Live; they are ignored)
pub(super) const PKG_W: usize = 48; // package name
pub(super) const SUM_KEY_W: usize = 48;
pub(super) const SUM_W: usize = 128; // SHA-512 in hexadecimal
pub(super) const EXTS: [&str; 6] = ["otf", "ttf", "tfm", "pfb", "sty", "cls"];

pub(super) struct IndexPaths {
    pub(super) files: std::path::PathBuf,
    pub(super) lower: std::path::PathBuf,
    pub(super) sums: std::path::PathBuf,
}

pub(super) fn index_paths(dir: &std::path::Path) -> IndexPaths {
    IndexPaths {
        files: dir.join("index-files.idx"),
        lower: dir.join("index-lowercase.idx"),
        sums: dir.join("index-sha512.idx"),
    }
}

/// First line of the files: format version and a mark of the index source (if the source changes, the index is rebuilt).
pub(super) fn index_header() -> String {
    let h = sha512_hex(tlpdb_urls().join("|").as_bytes());
    format!("#neoleaf-tl-index {IDX_VERSION} {}", &h[..16])
}

pub(super) fn record(key: &str, kw: usize, val: &str, vw: usize) -> Vec<u8> {
    let mut r = format!("{key:<kw$}{val:<vw$}").into_bytes();
    r.push(b'\n');
    r
}

pub(super) fn header_ok(path: &std::path::Path, kw: usize, vw: usize, header: &str) -> bool {
    use std::os::unix::fs::FileExt;
    let rec = kw + vw + 1;
    let Ok(f) = std::fs::File::open(path) else {
        return false;
    };
    let Ok(md) = f.metadata() else { return false };
    if (md.len() as usize) < rec || !(md.len() as usize).is_multiple_of(rec) {
        return false;
    }
    let mut buf = vec![0u8; rec];
    f.read_exact_at(&mut buf, 0).is_ok() && buf.starts_with(header.as_bytes())
}

/// Do the three files exist, have the right size and come from the current source?
pub(super) fn index_ok(dir: &std::path::Path) -> bool {
    let (p, h) = (index_paths(dir), index_header());
    header_ok(&p.files, KEY_W, PKG_W, &h)
        && header_ok(&p.lower, KEY_W, PKG_W, &h)
        && header_ok(&p.sums, SUM_KEY_W, SUM_W, &h)
}

/// Binary search for `key` in a file of fixed records (the first record is the header).
pub(super) fn lookup(path: &std::path::Path, kw: usize, vw: usize, key: &str) -> Option<String> {
    use std::os::unix::fs::FileExt;
    if key.is_empty() || key.len() > kw {
        return None;
    }
    let f = std::fs::File::open(path).ok()?;
    let rec = kw + vw + 1;
    let n = (f.metadata().ok()?.len() as usize / rec).checked_sub(1)?;
    let target = format!("{key:<kw$}").into_bytes();
    let (mut lo, mut hi) = (0usize, n);
    let mut buf = vec![0u8; rec];
    while lo < hi {
        let mid = (lo + hi) / 2;
        f.read_exact_at(&mut buf, ((mid + 1) * rec) as u64).ok()?;
        match buf[..kw].cmp(&target[..]) {
            std::cmp::Ordering::Equal => {
                return Some(
                    String::from_utf8_lossy(&buf[kw..kw + vw])
                        .trim_end()
                        .to_string(),
                );
            }
            std::cmp::Ordering::Less => lo = mid + 1,
            std::cmp::Ordering::Greater => hi = mid,
        }
    }
    None
}

/// Writes a sorted file (temporary file and rename, so it is never left half written).
pub(super) fn write_sorted(
    path: &std::path::Path,
    kw: usize,
    vw: usize,
    header: &str,
    mut entries: Vec<(String, String)>,
) -> std::io::Result<usize> {
    use std::io::Write;
    entries.retain(|(k, v)| {
        !k.is_empty() && k.len() <= kw && v.len() <= vw && !k.contains(' ') && !v.contains(' ')
    });
    entries.sort();
    entries.dedup_by(|a, b| a.0 == b.0);
    let tmp = path.with_extension(format!("tmp-{}", std::process::id()));
    {
        let mut w = std::io::BufWriter::new(std::fs::File::create(&tmp)?);
        let mut head = format!("{header:<w$}", w = kw + vw).into_bytes();
        head.push(b'\n');
        w.write_all(&head)?;
        for (k, v) in &entries {
            w.write_all(&record(k, kw, v, vw))?;
        }
        w.flush()?;
    }
    std::fs::rename(&tmp, path)?;
    Ok(entries.len())
}

/// Builds the three index files from the text of `texlive.tlpdb`.
pub(super) fn build_index_files(
    dir: &std::path::Path,
    text: &str,
    header: &str,
) -> std::io::Result<usize> {
    std::fs::create_dir_all(dir)?;
    let p = index_paths(dir);
    let files = parse_tlpdb(text);
    let mut entries: Vec<(String, String)> = files.into_iter().collect();
    entries.sort();
    // lowercase: the case-insensitive lookup. If two names become the same, the first one wins (in alphabetical order).
    let mut lower: std::collections::BTreeMap<String, String> = std::collections::BTreeMap::new();
    for (k, v) in &entries {
        lower
            .entry(k.to_ascii_lowercase())
            .or_insert_with(|| v.clone());
    }
    let n = write_sorted(&p.files, KEY_W, PKG_W, header, entries)?;
    write_sorted(&p.lower, KEY_W, PKG_W, header, lower.into_iter().collect())?;
    write_sorted(
        &p.sums,
        SUM_KEY_W,
        SUM_W,
        header,
        parse_tlpdb_sums(text).into_iter().collect(),
    )?;
    Ok(n)
}

pub(super) static INDEX_BUILD: tokio::sync::Mutex<()> = tokio::sync::Mutex::const_new(());

/// Ensures the on-disk index exists and is from the current source; if not, downloads `texlive.tlpdb`, decompresses it and builds the files.
pub(super) async fn ensure_index() -> Result<(), String> {
    let dir = cache_dir();
    if index_ok(&dir) {
        return Ok(());
    }
    let _g = INDEX_BUILD.lock().await;
    if index_ok(&dir) {
        return Ok(());
    }
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::limited(5))
        .timeout(Duration::from_secs(120))
        .user_agent("NeoLeaf/0.1 (+https://neoleaf.science)")
        .build()
        .map_err(|e| e.to_string())?;
    let mut data = Err("TeX Live index unavailable".to_string());
    for url in &tlpdb_urls() {
        data = download(&http, url).await;
        if data.is_ok() {
            break;
        }
    }
    let data = data?;
    // decompressing (xz) and building the files is several seconds of CPU work: outside the threads that serve requests
    let n = tokio::task::spawn_blocking(move || {
        let mut out = LimitedVec {
            buf: Vec::new(),
            limit: 120 * 1024 * 1024,
        };
        lzma_rs::xz_decompress(&mut Cursor::new(data), &mut out)
            .map_err(|_| "Invalid TeX Live index".to_string())?;
        let text = String::from_utf8_lossy(&out.buf);
        build_index_files(&dir, &text, &index_header())
            .map_err(|e| format!("Could not write the TeX Live index: {e}"))
    })
    .await
    .map_err(|e| format!("TeX Live index: {e}"))??;
    eprintln!("TeX Live index built on disk: {n} files");
    crate::trim_memory(); // give back to the system the memory used while building
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::ctan::test_support::*;

    #[test]
    fn tlpdb_index() {
        let db = "name lm\ncategory Package\nrelocated 1\nrunfiles size=10\n RELOC/tex/latex/lm/lmodern.sty\n RELOC/tex/latex/lm/t1lmr.fd\n RELOC/fonts/tfm/public/lm/lmr10.tfm\n RELOC/fonts/opentype/public/fira/FiraSans-Book.otf\ndocfiles size=3\n RELOC/doc/fonts/lm/README\n\nname amsmath\ncategory Package\nrunfiles size=1\n texmf-dist/tex/latex/amsmath/amsbsy.sty\n\nname latex-amsmath-dev\ncategory Package\nrunfiles size=1\n texmf-dist/tex/latex/amsmath-dev/amsbsy.sty\n\nname tools.x86_64-linux\nrunfiles size=1\n bin/x86_64-linux/tool\n";
        let m = parse_tlpdb(db);
        assert_eq!(m.get("lmodern.sty").map(String::as_str), Some("lm"));
        assert_eq!(m.get("t1lmr.fd").map(String::as_str), Some("lm"));
        assert_eq!(
            m.get("FiraSans-Book.otf").map(String::as_str),
            Some("lm"),
            ".otf fonts enter the index"
        );
        assert_eq!(
            m.get("amsbsy.sty").map(String::as_str),
            Some("amsmath"),
            "prefers the package without -dev"
        );
        assert_eq!(
            m.get("lmr10.tfm").map(String::as_str),
            Some("lm"),
            ".tfm fonts enter the index"
        );
        assert!(!m.contains_key("tool"), "executables do not enter");
        let dbb = "name natbib\nrunfiles size=2\n texmf-dist/tex/latex/natbib/natbib.sty\n texmf-dist/bibtex/bst/natbib/plainnat.bst\n texmf-dist/bibtex/bib/natbib/x.bib\n";
        let mb = parse_tlpdb(dbb);
        assert_eq!(
            mb.get("plainnat.bst").map(String::as_str),
            Some("natbib"),
            ".bst styles enter the index"
        );
        assert!(!mb.contains_key("x.bib"));
        let db2 = "name xkeyval\nrunfiles size=3\n texmf-dist/tex/latex/xkeyval/xkeyval.sty\n texmf-dist/tex/generic/xkeyval/xkeyval.tex\n texmf-dist/doc/latex/xkeyval/leia.tex\n";
        let m2 = parse_tlpdb(db2);
        assert_eq!(
            m2.get("xkeyval.tex").map(String::as_str),
            Some("xkeyval"),
            ".tex files read by \\input are also indexed"
        );
        assert!(
            !m2.contains_key("leia.tex"),
            "documentation outside tex/ does not enter"
        );
    }

    #[test]
    fn index_checksums() {
        let m = parse_tlpdb_sums(
            "name a\ncontainerchecksum ABC\ndoccontainerchecksum zzz\n\nname b\ncontainerchecksum def\n",
        );
        assert_eq!(m.get("a").map(String::as_str), Some("abc"));
        assert_eq!(m.get("b").map(String::as_str), Some("def"));
        assert_eq!(m.len(), 2, "doccontainerchecksum does not count");
    }

    const TLPDB_SAMPLE: &str = "name lm\ncategory Package\nrunfiles size=10\n texmf-dist/tex/latex/lm/lmodern.sty\n texmf-dist/tex/latex/lm/T1lmr.fd\n texmf-dist/fonts/tfm/public/lm/lmr10.tfm\n texmf-dist/fonts/opentype/public/fira/FiraSans-Book.otf\ncontainerchecksum AAAA\n\nname amsmath\ncategory Package\nrunfiles size=1\n texmf-dist/tex/latex/amsmath/amsbsy.sty\ncontainerchecksum bbbb\n\nname fira\ncategory Package\nrunfiles size=1\n texmf-dist/fonts/opentype/public/fira/FiraSans-Book.otf\n texmf-dist/fonts/opentype/public/fira/FiraSans-Bold.otf\ncontainerchecksum cccc\n";

    #[test]
    fn on_disk_index_finds_files_and_checks_the_header() {
        let dir = new_dir();
        let h = "#neoleaf-tl-index v1 test00000000000";
        assert!(!index_ok(&dir), "without files it is not valid");
        let n = build_index_files(&dir, TLPDB_SAMPLE, h).unwrap();
        assert!(n >= 4);
        let p = index_paths(&dir);
        // files whose header is from another source are not valid
        assert!(
            header_ok(&p.files, KEY_W, PKG_W, h)
                && !header_ok(
                    &p.files,
                    KEY_W,
                    PKG_W,
                    "#neoleaf-tl-index v1 other000000000000"
                )
        );
        assert_eq!(
            lookup(&p.files, KEY_W, PKG_W, "amsbsy.sty").as_deref(),
            Some("amsmath")
        );
        assert_eq!(
            lookup(&p.files, KEY_W, PKG_W, "lmr10.tfm").as_deref(),
            Some("lm")
        );
        assert_eq!(lookup(&p.files, KEY_W, PKG_W, "no-existe.sty"), None);
        assert_eq!(lookup(&p.files, KEY_W, PKG_W, ""), None);
        assert_eq!(
            lookup(&p.files, KEY_W, PKG_W, &"x".repeat(200)),
            None,
            "name longer than the field"
        );
        // case and extension: what the browser compiler asks for
        assert_eq!(lookup_package(&dir, "T1lmr.fd").as_deref(), Some("lm"));
        assert_eq!(
            lookup_package(&dir, "t1lmr.fd").as_deref(),
            Some("lm"),
            "ignores case"
        );
        assert_eq!(
            lookup_package(&dir, "lmodern").as_deref(),
            Some("lm"),
            "without extension"
        );
        assert_eq!(
            lookup_package(&dir, "FiraSans-Bold").as_deref(),
            Some("fira")
        );
        assert_eq!(lookup_package(&dir, "amsbsy").as_deref(), Some("amsmath"));
        assert_eq!(lookup_package(&dir, "inexistente"), None);
        // SHA-512 per package
        assert_eq!(
            lookup(&p.sums, SUM_KEY_W, SUM_W, "lm").as_deref(),
            Some("aaaa")
        );
        assert_eq!(
            lookup(&p.sums, SUM_KEY_W, SUM_W, "fira").as_deref(),
            Some("cccc")
        );
        // truncated file: the index stops being valid (it will be rebuilt)
        let len = std::fs::metadata(&p.files).unwrap().len();
        std::fs::OpenOptions::new()
            .write(true)
            .open(&p.files)
            .unwrap()
            .set_len(len - 5)
            .unwrap();
        assert!(!header_ok(&p.files, KEY_W, PKG_W, h));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[tokio::test]
    async fn index_is_rebuilt_when_the_source_changes() {
        use std::sync::{Arc, atomic::AtomicUsize};
        let _a = ENV_LOCK.lock().await;
        let mut v1 = Vec::new();
        lzma_rs::xz_compress(&mut Cursor::new(TLPDB_SAMPLE.as_bytes().to_vec()), &mut v1).unwrap();
        let other = TLPDB_SAMPLE.replace("amsbsy.sty", "new.sty");
        let mut v2 = Vec::new();
        lzma_rs::xz_compress(&mut Cursor::new(other.into_bytes()), &mut v2).unwrap();
        let a = fake_server(vec![("tlpdb", v1)], Arc::new(AtomicUsize::new(0))).await;
        let b = fake_server(vec![("tlpdb", v2)], Arc::new(AtomicUsize::new(0))).await;
        let dir = new_dir();
        unsafe { std::env::set_var("TL_CACHE_DIR", &dir) };
        unsafe { std::env::set_var("TLPDB_URL", format!("{a}/tlpdb")) };
        assert_eq!(
            package_for_file("amsbsy.sty").await.unwrap().as_deref(),
            Some("amsmath")
        );
        let m1 = std::fs::metadata(index_paths(&dir).files)
            .unwrap()
            .modified()
            .unwrap();
        // same source: does not build again
        assert_eq!(
            package_for_file("amsbsy.sty").await.unwrap().as_deref(),
            Some("amsmath")
        );
        assert_eq!(
            std::fs::metadata(index_paths(&dir).files)
                .unwrap()
                .modified()
                .unwrap(),
            m1
        );
        // new source: rebuilds and the new content takes effect
        unsafe { std::env::set_var("TLPDB_URL", format!("{b}/tlpdb")) };
        assert_eq!(
            package_for_file("new.sty").await.unwrap().as_deref(),
            Some("amsmath")
        );
        assert_eq!(package_for_file("amsbsy.sty").await.unwrap(), None);
        // no network and no index: clear error, does not hang
        let empty = new_dir();
        unsafe { std::env::set_var("TL_CACHE_DIR", &empty) };
        unsafe { std::env::set_var("TLPDB_URL", "http://127.0.0.1:1/tlpdb") };
        assert!(package_for_file("amsbsy.sty").await.is_err());
        let _ = std::fs::remove_dir_all(&dir);
        let _ = std::fs::remove_dir_all(&empty);
    }
}
