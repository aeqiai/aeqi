//! Prompt-cache substrate (T1.11).
//!
//! Substrate-level support for **frozen-snapshot** prompt caching. Tag
//! policies declare which content categories deserve a cache_control
//! breakpoint, idea assembly threads that signal through to the assembled
//! output as `AssembledPromptSegment`s (re-exported below from
//! [`aeqi_core::prompt`]), and provider implementations decide whether to
//! emit the marker on the wire (Anthropic does; OpenRouter/OpenAI strip).
//!
//! ## Why segments instead of a flat string
//!
//! The legacy assembler returned a single concatenated string. To carry
//! cache-control metadata up to the provider boundary without inventing a
//! new side-channel, the assembler now also produces a parallel segment vec
//! capturing the per-idea content + per-segment cache marker. The flat
//! `AssembledContext::system` string is still derived from the segments
//! (joined with the legacy `\n\n---\n\n` separator) so existing readers
//! stay byte-identical when no policy opts in.
//!
//! ## 4-breakpoint cap (Anthropic)
//!
//! Anthropic caps a single request at **4 cache breakpoints** total
//! (across system + tools + messages combined). The Anthropic provider
//! already spends three of those on the latest tool definition and the
//! tail messages; the substrate budget for system-content markers is
//! therefore tight. Strategy: **keep the LAST N marked segments** (most-
//! recent stable content) and silently drop the marker on earlier ones.
//! The text still ships; only the cache_control annotation is dropped.
//! "Most-recent" is the natural choice — root-ancestor identity comes
//! earliest in the assembled order, so when more breakpoints are wanted
//! than the cap allows, the segments closest to the user message (most
//! likely to be reused on the next turn) get pinned and the deeper
//! ancestors stay unpinned.
//!
//! See [`apply_breakpoint_cap`] for the exact retention rule.

pub use aeqi_core::prompt::{AssembledPromptSegment, CacheControl};

/// Maximum number of cache breakpoints aeqi will emit on the **system
/// content** for a single Anthropic request. Anthropic caps the total
/// request at 4 (across system + tools + messages); this constant pins the
/// substrate-side budget so seed authors can opt as many tag policies into
/// `cache_breakpoint=true` as they like without busting the API limit.
pub const MAX_CACHE_BREAKPOINTS: usize = 4;

/// Apply the Anthropic 4-breakpoint cap to a sequence of segments.
///
/// Heuristic: when more than `MAX_CACHE_BREAKPOINTS` segments carry a
/// marker, keep the marker on the LAST `MAX_CACHE_BREAKPOINTS` and strip it
/// from the earlier ones. The text content is preserved verbatim — only
/// the cache annotation is dropped. The "keep last" rule reflects the
/// assembly order: root ancestors come first, descendants come later, so
/// the segments closest to the user prompt (most likely to be reused on
/// the next turn) are the ones pinned.
///
/// Mutates in place so callers can assemble once and apply the cap as a
/// final step before handing the segments to the provider.
pub fn apply_breakpoint_cap(segments: &mut [AssembledPromptSegment]) {
    let marked: Vec<usize> = segments
        .iter()
        .enumerate()
        .filter_map(|(i, s)| s.cache_control.is_some().then_some(i))
        .collect();
    if marked.len() <= MAX_CACHE_BREAKPOINTS {
        return;
    }
    let drop_count = marked.len() - MAX_CACHE_BREAKPOINTS;
    for &idx in marked.iter().take(drop_count) {
        segments[idx].cache_control = None;
    }
}

/// Project a slice of segments to the legacy flat-string `system` field
/// shape. Joins with `\n\n---\n\n` to match the pre-T1.11 separator so
/// downstream readers (UI, ipc events, telemetry) remain byte-identical.
///
/// Empty segments are skipped to match the pre-T1.11 behaviour where
/// `append_idea` filters empty content before pushing.
pub fn segments_to_system_string(segments: &[AssembledPromptSegment]) -> String {
    let parts: Vec<&str> = segments
        .iter()
        .map(|s| s.content.as_str())
        .filter(|s| !s.is_empty())
        .collect();
    parts.join("\n\n---\n\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cap_under_limit_is_a_noop() {
        let mut segs = vec![
            AssembledPromptSegment::ephemeral("a"),
            AssembledPromptSegment::plain("b"),
            AssembledPromptSegment::ephemeral("c"),
        ];
        apply_breakpoint_cap(&mut segs);
        assert_eq!(segs[0].cache_control, Some(CacheControl::Ephemeral));
        assert!(segs[1].cache_control.is_none());
        assert_eq!(segs[2].cache_control, Some(CacheControl::Ephemeral));
    }

    #[test]
    fn cap_keeps_last_n_marked_segments() {
        // 6 marked segments, cap at 4 → first 2 lose their markers.
        let mut segs = vec![
            AssembledPromptSegment::ephemeral("a"),
            AssembledPromptSegment::ephemeral("b"),
            AssembledPromptSegment::ephemeral("c"),
            AssembledPromptSegment::ephemeral("d"),
            AssembledPromptSegment::ephemeral("e"),
            AssembledPromptSegment::ephemeral("f"),
        ];
        apply_breakpoint_cap(&mut segs);
        assert!(segs[0].cache_control.is_none());
        assert!(segs[1].cache_control.is_none());
        assert_eq!(segs[2].cache_control, Some(CacheControl::Ephemeral));
        assert_eq!(segs[3].cache_control, Some(CacheControl::Ephemeral));
        assert_eq!(segs[4].cache_control, Some(CacheControl::Ephemeral));
        assert_eq!(segs[5].cache_control, Some(CacheControl::Ephemeral));
        // Text is never mutated, only the marker.
        assert_eq!(segs[0].content, "a");
        assert_eq!(segs[5].content, "f");
    }

    #[test]
    fn cap_skips_unmarked_segments_when_counting() {
        let mut segs = vec![
            AssembledPromptSegment::ephemeral("m1"),
            AssembledPromptSegment::plain("p1"),
            AssembledPromptSegment::ephemeral("m2"),
            AssembledPromptSegment::plain("p2"),
            AssembledPromptSegment::ephemeral("m3"),
            AssembledPromptSegment::ephemeral("m4"),
            AssembledPromptSegment::ephemeral("m5"),
        ];
        apply_breakpoint_cap(&mut segs);
        // 5 marked, cap at 4 → strip the first marked one (m1).
        assert!(segs[0].cache_control.is_none(), "first marked dropped");
        assert!(segs[1].cache_control.is_none(), "plain unchanged");
        assert_eq!(
            segs[2].cache_control,
            Some(CacheControl::Ephemeral),
            "m2 retained"
        );
        assert!(segs[3].cache_control.is_none(), "plain unchanged");
        assert_eq!(segs[4].cache_control, Some(CacheControl::Ephemeral));
        assert_eq!(segs[5].cache_control, Some(CacheControl::Ephemeral));
        assert_eq!(segs[6].cache_control, Some(CacheControl::Ephemeral));
    }

    #[test]
    fn segments_to_system_string_joins_with_legacy_separator() {
        let segs = vec![
            AssembledPromptSegment::plain("alpha"),
            AssembledPromptSegment::ephemeral("beta"),
            AssembledPromptSegment::plain(""),
            AssembledPromptSegment::plain("gamma"),
        ];
        let s = segments_to_system_string(&segs);
        assert_eq!(s, "alpha\n\n---\n\nbeta\n\n---\n\ngamma");
    }
}
