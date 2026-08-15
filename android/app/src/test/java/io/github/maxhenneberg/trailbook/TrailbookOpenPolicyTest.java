package io.github.maxhenneberg.trailbook;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public final class TrailbookOpenPolicyTest {
    @Test
    public void acceptsOnlyContentTrailbookWithTargetedMimeTypes() {
        assertTrue(TrailbookOpenPolicy.validate("content", TrailbookOpenPolicy.TRAILBOOK_MIME, "Japan.trailbook", 42).accepted);
        assertTrue(TrailbookOpenPolicy.validate("content", "application/octet-stream", "Japan.trailbook", -1).accepted);
        assertTrue(TrailbookOpenPolicy.validate("content", "application/json; charset=utf-8", "Japan.trailbook", 42).accepted);
        assertEquals("unsupported_scheme", TrailbookOpenPolicy.validate("file", TrailbookOpenPolicy.TRAILBOOK_MIME, "Japan.trailbook", 42).code);
        assertEquals("mime_mismatch", TrailbookOpenPolicy.validate("content", "text/html", "Japan.trailbook", 42).code);
        assertEquals("unsupported_extension", TrailbookOpenPolicy.validate("content", "application/json", "Japan.json", 42).code);
    }

    @Test
    public void rejectsPathsAndUnsafeSizesBeforeReading() {
        assertEquals("unsafe_filename", TrailbookOpenPolicy.validate("content", TrailbookOpenPolicy.TRAILBOOK_MIME, "../Japan.trailbook", 42).code);
        assertEquals("unsafe_filename", TrailbookOpenPolicy.validate("content", TrailbookOpenPolicy.TRAILBOOK_MIME, "folder/Japan.trailbook", 42).code);
        assertEquals("empty_file", TrailbookOpenPolicy.validate("content", TrailbookOpenPolicy.TRAILBOOK_MIME, "Japan.trailbook", 0).code);
        assertEquals("file_too_large", TrailbookOpenPolicy.validate("content", TrailbookOpenPolicy.TRAILBOOK_MIME, "Japan.trailbook", TrailbookOpenPolicy.MAX_FILE_BYTES + 1L).code);
        assertFalse(TrailbookOpenPolicy.validate("content", "image/png", "Japan.trailbook", 42).accepted);
    }
}
