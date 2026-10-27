//! WebAssembly shim over Badness for the NeoLeaf editor.
//!
//! Everything works on text in memory: the browser holds the project, there is no disk. Positions leave this module as UTF-16 code units
//! (what JavaScript strings and Monaco use), so the page never sees byte offsets.

use std::path::Path;

use badness::declarations::ResolvedDeclarations;
use badness::linter::{Applicability, apply_fixes, check_document};
use badness::parser::{LatexFlavor, LexConfig};
use badness_formatter::{FormatStyle, MathWrap, WrapMode};
use serde::Serialize;
use wasm_bindgen::prelude::*;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Tex,
    StyCls,
    Dtx,
    Bib,
}

fn kind(s: &str) -> Result<Kind, String> {
    match s {
        "tex" => Ok(Kind::Tex),
        "sty-cls" => Ok(Kind::StyCls),
        "dtx" => Ok(Kind::Dtx),
        "bib" => Ok(Kind::Bib),
        other => Err(format!("unsupported file type: {other:?} (expected \"tex\", \"sty-cls\", \"dtx\" or \"bib\")")),
    }
}

fn lex_config(k: Kind) -> LexConfig {
    LexConfig {
        flavor: if k == Kind::StyCls { LatexFlavor::Package } else { LatexFlavor::Document },
        dtx: k == Kind::Dtx,
    }
}

fn style(line_width: Option<usize>, indent_width: Option<usize>, wrap: Option<&str>, math_wrap: Option<&str>) -> Result<FormatStyle, String> {
    let default = FormatStyle::default();
    Ok(FormatStyle {
        line_width: line_width.unwrap_or(default.line_width),
        indent_width: indent_width.unwrap_or(default.indent_width),
        wrap: match wrap {
            None => default.wrap,
            Some("reflow") => WrapMode::Reflow,
            Some("stable") => WrapMode::Stable,
            Some("sentence") => WrapMode::Sentence,
            Some("semantic") => WrapMode::Semantic,
            Some("preserve") => WrapMode::Preserve,
            Some(other) => return Err(format!("unsupported wrap mode: {other:?}")),
        },
        math_wrap: match math_wrap {
            None | Some("auto") => MathWrap::Auto,
            Some("preserve") => MathWrap::Preserve,
            Some("single-line") => MathWrap::SingleLine,
            Some("break") => MathWrap::Break,
            Some(other) => return Err(format!("unsupported math wrap mode: {other:?}")),
        },
        ..default
    })
}

/// Byte offset -> UTF-16 offset, line and column (both 1-based), for one text.
struct Positions {
    ascii: bool,
    utf16: Vec<u32>,       // by byte offset, only when the text is not ASCII
    line_starts: Vec<usize>, // byte offsets
    text: String,
}

impl Positions {
    fn new(text: &str) -> Self {
        let ascii = text.is_ascii();
        let mut utf16 = Vec::new();
        if !ascii {
            utf16 = vec![0; text.len() + 1];
            let mut units = 0u32;
            let mut last = 0usize;
            for (i, ch) in text.char_indices() {
                for slot in &mut utf16[last..=i] {
                    *slot = units;
                }
                units += ch.len_utf16() as u32;
                // bytes inside a multi-byte character snap forward
                for slot in &mut utf16[i + 1..i + ch.len_utf8()] {
                    *slot = units;
                }
                last = i + ch.len_utf8();
            }
            for slot in &mut utf16[last..] {
                *slot = units;
            }
        }
        let mut line_starts = vec![0];
        for (i, b) in text.bytes().enumerate() {
            if b == b'\n' {
                line_starts.push(i + 1);
            }
        }
        Self { ascii, utf16, line_starts, text: text.to_string() }
    }

    fn offset(&self, byte: usize) -> u32 {
        let byte = byte.min(self.text.len());
        if self.ascii { byte as u32 } else { self.utf16[byte] }
    }

    fn line_col(&self, byte: usize) -> (u32, u32) {
        let byte = byte.min(self.text.len());
        let line = match self.line_starts.binary_search(&byte) {
            Ok(i) => i,
            Err(i) => i - 1,
        };
        let start = self.line_starts[line];
        let col = self.offset(byte) - self.offset(start);
        (line as u32 + 1, col + 1)
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Edit {
    start: u32,
    end: u32,
    content: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fix {
    description: String,
    safe: bool,
    edits: Vec<Edit>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Finding {
    rule: String,
    severity: &'static str,
    message: String,
    start: u32,
    end: u32,
    line: u32,
    column: u32,
    end_line: u32,
    end_column: u32,
    fix: Option<Fix>,
}

fn severity(s: badness::linter::Severity) -> &'static str {
    match s {
        badness::linter::Severity::Error => "error",
        badness::linter::Severity::Warning => "warning",
        badness::linter::Severity::Info => "info",
        badness::linter::Severity::Hint => "hint",
    }
}

/// Formats `input`. `file_type` is "tex", "sty-cls", "dtx" or "bib"; `wrap` is "reflow", "stable", "sentence", "semantic" or "preserve";
/// `math_wrap` is "auto", "preserve", "single-line" or "break". Returns the formatted text.
#[wasm_bindgen]
pub fn format(
    input: &str,
    file_type: &str,
    line_width: Option<usize>,
    indent_width: Option<usize>,
    wrap: Option<String>,
    math_wrap: Option<String>,
) -> Result<String, JsError> {
    let run = || -> Result<String, String> {
        let k = kind(file_type)?;
        let st = style(line_width, indent_width, wrap.as_deref(), math_wrap.as_deref())?;
        match k {
            Kind::Bib => badness_formatter::bib::format_with_style(input, st).map_err(|e| e.to_string()),
            _ => badness_formatter::formatter::format_with_style_flavored(input, st, lex_config(k)).map_err(|e| e.to_string()),
        }
    };
    run().map_err(|m| JsError::new(&m))
}

/// Syntax errors and lint findings of one file, as a JSON array of
/// `{rule, severity, message, start, end, line, column, endLine, endColumn, fix}` (offsets in UTF-16 code units).
/// The rules that need the whole project (undefined references and citations) stay inactive here.
#[wasm_bindgen]
pub fn check(input: &str, file_type: &str) -> Result<String, JsError> {
    let run = || -> Result<String, String> {
        let k = kind(file_type)?;
        if k == Kind::Bib {
            // BibTeX: only the parser's errors (the formatter crate owns the BibTeX parser)
            let parsed = badness_parser::bib::parse(input);
            let pos = Positions::new(input);
            let out: Vec<Finding> = parsed
                .errors
                .iter()
                .map(|e| finding("parse".into(), badness::linter::Severity::Error, e.message.clone(), e.start, e.end, None, &pos))
                .collect();
            return serde_json::to_string(&out).map_err(|e| e.to_string());
        }
        let diags = check_document(Path::new("main.tex"), input, lex_config(k), &ResolvedDeclarations::default());
        let pos = Positions::new(input);
        let out: Vec<Finding> = diags
            .into_iter()
            .map(|d| {
                let fix = d.fix.as_ref().map(|f| Fix {
                    description: f.description.clone(),
                    safe: f.applicability == Applicability::Safe,
                    edits: f
                        .edits
                        .iter()
                        .map(|e| Edit { start: pos.offset(e.start), end: pos.offset(e.end), content: e.content.clone() })
                        .collect(),
                });
                finding(d.rule.to_string(), d.severity, d.message, d.start, d.end, fix, &pos)
            })
            .collect();
        serde_json::to_string(&out).map_err(|e| e.to_string())
    };
    run().map_err(|m| JsError::new(&m))
}

fn finding(rule: String, sev: badness::linter::Severity, message: String, start: usize, end: usize, fix: Option<Fix>, pos: &Positions) -> Finding {
    let (line, column) = pos.line_col(start);
    let (end_line, end_column) = pos.line_col(end);
    Finding { rule, severity: severity(sev), message, start: pos.offset(start), end: pos.offset(end), line, column, end_line, end_column, fix }
}

/// Applies every automatic fix of one file (`include_unsafe` also applies the ones that may change meaning) until nothing more applies,
/// and returns the new text.
#[wasm_bindgen]
pub fn fix(input: &str, file_type: &str, include_unsafe: bool) -> Result<String, JsError> {
    let run = || -> Result<String, String> {
        let k = kind(file_type)?;
        if k == Kind::Bib {
            return Ok(input.to_string());
        }
        let mut text = input.to_string();
        for _ in 0..8 {
            let diags = check_document(Path::new("main.tex"), &text, lex_config(k), &ResolvedDeclarations::default());
            let fixes: Vec<badness::linter::Fix> = diags.into_iter().filter_map(|d| d.fix).collect();
            if fixes.is_empty() {
                break;
            }
            let outcome = apply_fixes(&text, &fixes, include_unsafe);
            if outcome.output == text {
                break;
            }
            text = outcome.output;
        }
        Ok(text)
    };
    run().map_err(|m| JsError::new(&m))
}
