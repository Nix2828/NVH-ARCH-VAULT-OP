/**
 * meetingNoteFromSink -- pure transcript-to-note transform.
 *
 * Ported from the plaud-meeting-delta-ingest sandbox script
 * (build_note_from_transcript.js) so the same transform can run NATIVELY, i.e.
 * without the sandbox's 10-writes-per-minute cap and 128 MB heap. A batch of
 * 20+ meetings tripped both when each note was written from the sandbox; the
 * native path (BuildMeetingNoteFromSinkTool) has neither limit and, like the
 * sink itself, never routes the transcript through the LLM context.
 *
 * This file is intentionally free of any Obsidian/plugin dependency so it is
 * unit-testable in isolation. The tool wrapper does the file I/O.
 */

/** A single Plaud get_transcript block (transaction, outline, ...). */
export interface PlaudBlock {
    data_type?: string;
    data_content?: string;
    [k: string]: unknown;
}

/**
 * One sinked get_transcript result, normalized.
 *
 * The MCP server ships two shapes and both reach this file:
 *   LEGACY  an array of blocks, the segments doubly-encoded in data_content.
 *           Carries no counters, so completeness cannot be checked.
 *   CURRENT one PAGE per call: { file_id, block, total, offset, limit,
 *           returned, next_cursor, segments: [...] }. `limit` is capped at 500
 *           server-side, so any recording above that arrives in several pages,
 *           each sinked to its own file.
 * Counters are null for the legacy shape; everything downstream treats null as
 * "unknown", never as zero.
 */
interface SinkPage {
    fileId: string | null;
    segments: Segment[];
    total: number | null;
    offset: number;
    nextCursor: string | null;
}

/** One decoded transcript segment. */
interface Segment {
    content?: string;
    speaker?: string;
    original_speaker?: string;
}

/** OKF frontmatter the caller supplies. `uid` is never set here. */
export interface MeetingFrontmatter {
    title?: string;
    description?: string;
    resource?: string;
    timestamp?: string;
    type?: string;
    tags?: string[] | string;
    moc?: string[] | string;
    related?: string[] | string;
}

export interface BuildResult {
    ok: true;
    body: string;
    transcriptChars: number;
    speakerLines: number;
    segmentCount: number;
}

/**
 * Decode the transaction block(s) into segments. get_transcript delivers the
 * segments as a DOUBLY-encoded JSON string inside data_content. Multiple
 * transaction blocks (pagination/merge) are concatenated in order.
 */
function parseSegments(blocks: PlaudBlock[]): Segment[] {
    const txBlocks = blocks.filter(
        (b) => b && b.data_type === 'transaction' && typeof b.data_content === 'string' && b.data_content.trim().length > 0,
    );
    if (txBlocks.length === 0) {
        throw new Error(
            "No 'transaction' block in the get_transcript result. Was get_transcript sinked (not get_note)? " +
            'A get_note sink carries a summary, not transcript segments, and cannot become a transcript note.',
        );
    }
    const segments: Segment[] = [];
    for (const b of txBlocks) {
        let arr: unknown;
        try {
            arr = JSON.parse(b.data_content as string);
        } catch (e) {
            throw new Error('transaction.data_content is not valid JSON: ' + String(e));
        }
        if (Array.isArray(arr)) {
            for (const s of arr) {
                if (s && typeof s === 'object') segments.push(s as Segment);
            }
        }
    }
    return segments;
}

/**
 * The one outcome that is neither a success nor a defect: the recording exists,
 * the call worked, and Plaud simply has nothing transcribed for it. It is worth
 * its own message because every other reading sends the caller somewhere false
 * -- a wrong id fails the MCP call outright, and a get_note sink carries a
 * summary rather than nothing at all. Retrying does not help; the recording
 * stays in the delta and is offered again on the next run.
 */
function noTranscriptError(): Error {
    return new Error(
        'The recording has no transcript: get_transcript succeeded but returned no segments, so Plaud has not ' +
        'transcribed this recording (yet). This is NOT a wrong file_id (that fails the call itself) and NOT a ' +
        'get_note sink. Skip the recording, report it as skipped, and offer it again on the next run. ' +
        'No note was written.',
    );
}

/**
 * Normalize ONE sinked get_transcript result into a page.
 *
 * Accepts both shapes (see SinkPage) and refuses everything else loudly. The
 * loud refusal matters: on 2026-08-22 the server had switched to the paged
 * object shape, the array-only guard here threw, and the import died after the
 * transcript was already on disk. An MCP error payload (e.g. the validation
 * error for `limit: 1000`) also lands here as parseable JSON, and it must not
 * be mistaken for a transcript.
 */
function extractSinkPage(payload: unknown): SinkPage {
    // NOT TRANSCRIBED (yet): a successful get_transcript for a recording Plaud
    // holds no transcript for answers with a bare `[]`. Verified live on
    // 2026-09-02 against file_id c0d5f45d7cac39687edd1ae079461a9a, a 3h10
    // recording: two bytes, no error. Shape-wise that is the legacy array, so
    // without this branch parseSegments explains it as a get_note mix-up, which
    // it demonstrably is not, and the caller goes hunting for the wrong bug.
    if (Array.isArray(payload) && payload.length === 0) throw noTranscriptError();
    // LEGACY: array of blocks, segments doubly-encoded, no counters.
    if (Array.isArray(payload)) {
        return { fileId: null, segments: parseSegments(payload as PlaudBlock[]), total: null, offset: 0, nextCursor: null };
    }
    // CURRENT: one page carrying its own segments plus the paging counters.
    if (payload && typeof payload === 'object') {
        const p = payload as Record<string, unknown>;
        const isTransaction = p.block === 'transaction' || p.data_type === 'transaction';
        if (isTransaction && Array.isArray(p.segments)) {
            const segments = (p.segments as unknown[]).filter((s): s is Segment => !!s && typeof s === 'object');
            // Same "nothing transcribed" case as the bare `[]` above, should the
            // server ever answer it in the paged shape instead. total 0 says the
            // recording holds no segments at all, which no partial page can.
            if (segments.length === 0 && p.total === 0) throw noTranscriptError();
            const cursor = p.next_cursor;
            return {
                fileId: typeof p.file_id === 'string' ? p.file_id : null,
                segments,
                total: typeof p.total === 'number' ? p.total : null,
                offset: typeof p.offset === 'number' ? p.offset : 0,
                nextCursor: typeof cursor === 'string' && cursor.length > 0 ? cursor : null,
            };
        }
    }
    throw new Error(
        'Unrecognized get_transcript sink shape: expected either a page object with block:"transaction" and a ' +
        '"segments" array, or the legacy array of transaction blocks. Was get_transcript sinked (not get_note), ' +
        'and did the call succeed? An MCP error payload is parseable JSON but carries no segments.',
    );
}

/**
 * Refuse to build a note from an incomplete set of pages.
 *
 * A truncated transcript is worse than a failed import: the note looks finished
 * and nothing downstream can tell that the last third of the conversation is
 * missing. So this throws, and the message carries what the caller needs to
 * recover -- the cursor to fetch next, or the two numbers that disagree. The
 * caller sinks the missing page and repeats the build; nothing has been written
 * or deleted at this point.
 *
 * The legacy shape has no counters, so it is exempt: nothing to check against.
 */
function assertComplete(pages: SinkPage[]): void {
    const ids = new Set(pages.map((p) => p.fileId).filter((id): id is string => id !== null));
    if (ids.size > 1) {
        throw new Error(
            `Sinks belong to different recordings (${[...ids].join(', ')}). One note is built from the pages of ` +
            'ONE recording; check that extra_sink_paths lists the follow-up pages of this file_id only.',
        );
    }

    const totals = pages.map((p) => p.total).filter((t): t is number => t !== null);
    if (totals.length === 0) return; // legacy shape, no counters to check

    const last = pages[pages.length - 1];
    if (last.nextCursor) {
        throw new Error(
            `Transcript incomplete: the last sinked page still carries next_cursor "${last.nextCursor}". ` +
            `Call get_transcript again with cursor:"${last.nextCursor}" (limit 500), sink it to its own file, ` +
            'and pass every page to this tool in one call. No note was written.',
        );
    }

    const expected = Math.max(...totals);
    const got = pages.reduce((n, p) => n + p.segments.length, 0);
    if (got !== expected) {
        throw new Error(
            `Transcript incomplete: the sinked pages hold ${got} segments but the recording has ${expected}. ` +
            (got < expected
                ? 'A page is missing -- fetch the remaining pages via next_cursor and pass all of them in one call.'
                : 'A page was passed twice -- pass each page exactly once, ordered by offset.') +
            ' No note was written.',
        );
    }
}

/**
 * Plaud's `start_at` is UTC but arrives as a bare ISO string with no zone
 * marker ("2026-07-24T06:00:27"). Written raw into the note it read 2h behind
 * Plaud's own display in summer. This converts a bare-UTC timestamp to the
 * host's LOCAL wall-clock time, DST-correct (winter +1h, summer +2h in Berlin),
 * because Date resolves the offset from the system zone's rules, not a fixed
 * number.
 *
 * A value that already carries a zone (`Z` or `+hh:mm`) is left as-is: it is
 * either already localized or explicitly zoned, and re-converting would double
 * the shift. An unparseable value is returned unchanged (fail safe).
 */
export function localizePlaudTimestamp(raw: string): string {
    if (!raw) return raw;
    // Only treat a bare "YYYY-MM-DDTHH:MM:SS" (no trailing Z / +hh:mm / -hh:mm) as UTC.
    const bareUtc = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(raw);
    if (!bareUtc) return raw;

    const [, y, mo, d, h, mi, s] = bareUtc;
    // Interpret the components as UTC.
    const utcMs = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
    const dt = new Date(utcMs);
    if (Number.isNaN(dt.getTime())) return raw;

    // Format the LOCAL components back into the same bare-ISO shape.
    const p = (n: number): string => String(n).padStart(2, '0');
    return (
        dt.getFullYear() + '-' + p(dt.getMonth() + 1) + '-' + p(dt.getDate()) +
        'T' + p(dt.getHours()) + ':' + p(dt.getMinutes()) + ':' + p(dt.getSeconds())
    );
}

/**
 * Extract the Plaud recording id from a `resource` frontmatter value. This is
 * the dedup key: a recording is "already imported" iff its id already appears
 * in some note's resource property. Kept pure (no Obsidian dep) so the dedup
 * rule is unit-tested; the tool wrapper feeds it metadataCache values.
 *
 * Accepts the three shapes that occur in the vault:
 *   "[plaud:c61779...](https://web.plaud.ai/file/c61779...)"  the OKF link (what we write)
 *   "plaud:c61779..."                                          a bare marker
 *   "...web.plaud.ai/file/c61779..."                           url-only fallback
 * Returns the lowercased id (case-insensitive dedup) or null when none is
 * recognizable. Non-strings return null so a stray array/number never matches.
 */
export function plaudIdFromResource(resource: unknown): string | null {
    if (typeof resource !== 'string' || resource.length === 0) return null;
    // Primary: the plaud:<id> marker (link text or the bare marker).
    const marker = /plaud:\s*['"]?([A-Za-z0-9]{8,})/i.exec(resource);
    if (marker) return marker[1].toLowerCase();
    // Fallback: the plaud.ai url, in case the marker text is ever dropped.
    const url = /plaud\.ai\/(?:file|share)\/([A-Za-z0-9]{8,})/i.exec(resource);
    if (url) return url[1].toLowerCase();
    return null;
}

export function quoteIfNeeded(value: string): string {
    const needsQuote = /[:#[\]{}",&*!|>%@`]/.test(value) || /^\s|\s$/.test(value) || value.includes('\\');
    // AUDIT 2026-07-27 L-1 (CWE-116): escape the backslash BEFORE the quote.
    // The old code escaped only `"`, so a value like `a:b\` became `"a:b\"` --
    // the trailing backslash escaped the closing quote and left the YAML string
    // open (frontmatter corruption / limited YAML injection). Backslash first,
    // then quote, or the escaping backslash we just inserted would be doubled.
    return needsQuote ? '"' + value.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"' : value;
}

/**
 * Build the full note markdown (frontmatter + transcript) from one or more
 * sinked get_transcript results. Several payloads are the pages of ONE
 * recording, joined in offset order; an incomplete set throws rather than
 * writing a note that is quietly missing its tail. Speaker labels stay RAW
 * (`**Speaker N:**`); naming is a later, evidence-bound step done by
 * meeting-summary, never guessed here.
 */
export function buildMeetingNoteFromPages(payloads: unknown[], frontmatter: MeetingFrontmatter): BuildResult {
    if (!Array.isArray(payloads) || payloads.length === 0) throw new Error('no get_transcript sink payload given');
    // Sort by offset, never trust argument order: a page list handed over in the
    // wrong order would otherwise produce a scrambled transcript that still
    // passes every count check.
    const pages = payloads.map(extractSinkPage).sort((a, b) => a.offset - b.offset);
    assertComplete(pages);
    const segments = pages.flatMap((p) => p.segments);
    if (segments.length === 0) throw new Error('transaction block had no segments');

    // Segments -> speaker turns; merge consecutive same-speaker segments.
    const turns: Array<{ name: string; text: string }> = [];
    for (const s of segments) {
        const label = String(s.speaker || s.original_speaker || 'Speaker ?').trim() || 'Speaker ?';
        const text = String(s.content || '').replace(/[ \t]+/g, ' ').trim();
        if (!text) continue;
        const last = turns[turns.length - 1];
        if (last && last.name === label) last.text += ' ' + text;
        else turns.push({ name: label, text });
    }
    if (turns.length === 0) throw new Error('transcript empty after cleanup');

    const transcript = turns.map((t) => '**' + t.name + ':** ' + t.text).join('\n\n');

    // Frontmatter. Same shape as the script so the note layout is identical.
    const fmLines: string[] = ['---', 'uid:'];
    const scalar = (k: keyof MeetingFrontmatter): void => {
        const v = frontmatter[k];
        if (v === undefined || v === null || v === '') { fmLines.push(k + ':'); return; }
        fmLines.push(k + ': ' + quoteIfNeeded(String(v)));
    };
    const list = (k: keyof MeetingFrontmatter): void => {
        const v = frontmatter[k];
        if (!v || (Array.isArray(v) && v.length === 0)) { fmLines.push(k + ':'); return; }
        const arr = Array.isArray(v) ? v : [v];
        fmLines.push(k + ':');
        for (const item of arr) fmLines.push('  - ' + String(item));
    };
    scalar('title');
    scalar('description');
    scalar('resource');
    list('tags');
    fmLines.push('type: ' + (frontmatter.type || 'meeting'));
    list('moc');
    list('related');
    // Plaud start_at is bare-UTC; localize so the note matches Plaud's display.
    {
        const ts = frontmatter.timestamp;
        if (ts === undefined || ts === null || ts === '') fmLines.push('timestamp:');
        else fmLines.push('timestamp: ' + quoteIfNeeded(localizePlaudTimestamp(String(ts))));
    }
    fmLines.push('---');

    // No summary placeholders: the note carries the raw transcript only. A
    // horizontal rule (`---`) sits between the frontmatter and the transcript
    // heading so the reading view separates the metadata block from the body.
    // The `## Transkript` heading is H2 (was H3) since it is now the sole body
    // section. meeting-summary adds any summary structure later on demand.
    const body =
        fmLines.join('\n') + '\n\n' +
        '---\n\n' +
        '## Transkript\n\n' +
        transcript + '\n';

    return {
        ok: true,
        body,
        transcriptChars: transcript.length,
        speakerLines: turns.length,
        segmentCount: segments.length,
    };
}

/**
 * Single-payload entry point, kept for callers and tests that hand over exactly
 * one sinked result. Both shapes go through the same normalization.
 */
export function buildMeetingNoteFromBlocks(payload: unknown, frontmatter: MeetingFrontmatter): BuildResult {
    return buildMeetingNoteFromPages([payload], frontmatter);
}
