package io.github.maxhenneberg.trailbook;

import java.text.Normalizer;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Pattern;

final class TrailbookOpenPolicy {
    static final int MAX_FILE_BYTES = 2 * 1024 * 1024;
    static final String TRAILBOOK_MIME = "application/vnd.trailbook.itinerary+json";
    private static final Set<String> ACCEPTED_MIME_TYPES = Set.of(
            TRAILBOOK_MIME,
            "application/octet-stream",
            "application/json"
    );
    private static final Pattern CONTROL = Pattern.compile("[\\x00-\\x1f\\x7f-\\x9f]");
    private static final Pattern TRAVERSAL = Pattern.compile("(^|[.\\s])\\.\\.([.\\s]|$)");

    private TrailbookOpenPolicy() {}

    static Decision validate(String scheme, String mimeType, String displayName, long declaredSize) {
        if (!"content".equalsIgnoreCase(scheme)) return Decision.error("unsupported_scheme");
        String name = normalizeName(displayName);
        if (name.isEmpty() || name.length() > 140 || name.contains("/") || name.contains("\\")
                || TRAVERSAL.matcher(name).find() || name.matches("(?i)^[a-z]:.*")) {
            return Decision.error("unsafe_filename");
        }
        if (!name.toLowerCase(Locale.ROOT).endsWith(".trailbook")) {
            return Decision.error("unsupported_extension");
        }
        String type = normalizeMime(mimeType);
        if (type.isEmpty()) type = "application/octet-stream";
        if (!ACCEPTED_MIME_TYPES.contains(type)) return Decision.error("mime_mismatch");
        if (declaredSize == 0) return Decision.error("empty_file");
        if (declaredSize > MAX_FILE_BYTES) return Decision.error("file_too_large");
        return Decision.accept(name, type);
    }

    private static String normalizeName(String value) {
        if (value == null) return "";
        return CONTROL.matcher(Normalizer.normalize(value, Normalizer.Form.NFKC))
                .replaceAll(" ").replaceAll("\\s+", " ").trim();
    }

    private static String normalizeMime(String value) {
        if (value == null) return "";
        int parameters = value.indexOf(';');
        String plain = parameters >= 0 ? value.substring(0, parameters) : value;
        return plain.trim().toLowerCase(Locale.ROOT);
    }

    static final class Decision {
        final boolean accepted;
        final String code;
        final String displayName;
        final String mimeType;

        private Decision(boolean accepted, String code, String displayName, String mimeType) {
            this.accepted = accepted;
            this.code = code;
            this.displayName = displayName;
            this.mimeType = mimeType;
        }

        static Decision accept(String displayName, String mimeType) {
            return new Decision(true, null, displayName, mimeType);
        }

        static Decision error(String code) {
            return new Decision(false, code, null, null);
        }
    }
}
