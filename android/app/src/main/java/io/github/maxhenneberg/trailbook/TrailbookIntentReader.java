package io.github.maxhenneberg.trailbook;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.OpenableColumns;
import android.util.Base64;

import org.json.JSONException;
import org.json.JSONObject;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;

final class TrailbookIntentReader {
    private TrailbookIntentReader() {}

    static JSONObject read(ContentResolver resolver, Intent intent) {
        if (!Intent.ACTION_VIEW.equals(intent.getAction())) return null;
        try {
            Uri uri = singleUri(intent);
            if (uri == null) return error("invalid_request");
            Metadata metadata = metadata(resolver, uri);
            String resolverType = resolver.getType(uri);
            String mimeType = resolverType == null || resolverType.isBlank() ? intent.getType() : resolverType;
            TrailbookOpenPolicy.Decision decision = TrailbookOpenPolicy.validate(
                    uri.getScheme(), mimeType, metadata.name, metadata.size
            );
            if (!decision.accepted) return error(decision.code);
            byte[] bytes = readBounded(resolver, uri);
            if (bytes.length == 0) return error("empty_file");
            return new JSONObject()
                    .put("kind", "file")
                    .put("name", decision.displayName)
                    .put("type", decision.mimeType)
                    .put("base64", Base64.encodeToString(bytes, Base64.NO_WRAP));
        } catch (SecurityException denied) {
            return error("permission_denied");
        } catch (TooLargeException tooLarge) {
            return error("file_too_large");
        } catch (IOException | RuntimeException | JSONException unreadable) {
            return error("unreadable_file");
        }
    }

    private static Uri singleUri(Intent intent) {
        ClipData clip = intent.getClipData();
        if (clip != null && clip.getItemCount() != 1) return null;
        Uri direct = intent.getData();
        Uri clipped = clip == null ? null : clip.getItemAt(0).getUri();
        if (direct != null && clipped != null && !direct.equals(clipped)) return null;
        return direct != null ? direct : clipped;
    }

    private static Metadata metadata(ContentResolver resolver, Uri uri) {
        String name = null;
        long size = -1;
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst()) {
                int nameColumn = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeColumn = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameColumn >= 0 && !cursor.isNull(nameColumn)) name = cursor.getString(nameColumn);
                if (sizeColumn >= 0 && !cursor.isNull(sizeColumn)) size = cursor.getLong(sizeColumn);
            }
        }
        return new Metadata(name, size);
    }

    private static byte[] readBounded(ContentResolver resolver, Uri uri) throws IOException, TooLargeException {
        try (InputStream input = resolver.openInputStream(uri)) {
            if (input == null) throw new IOException("Content provider returned no stream.");
            ByteArrayOutputStream output = new ByteArrayOutputStream();
            byte[] buffer = new byte[8192];
            int total = 0;
            for (int count; (count = input.read(buffer)) != -1;) {
                total += count;
                if (total > TrailbookOpenPolicy.MAX_FILE_BYTES) throw new TooLargeException();
                output.write(buffer, 0, count);
            }
            return output.toByteArray();
        }
    }

    private static JSONObject error(String code) {
        try { return new JSONObject().put("kind", "error").put("code", code); }
        catch (JSONException impossible) { throw new IllegalStateException(impossible); }
    }

    private static final class Metadata {
        final String name;
        final long size;
        Metadata(String name, long size) { this.name = name; this.size = size; }
    }

    private static final class TooLargeException extends Exception {}
}
