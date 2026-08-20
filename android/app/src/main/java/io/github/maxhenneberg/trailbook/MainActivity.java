package io.github.maxhenneberg.trailbook;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.webkit.WebResourceError;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;

import org.json.JSONObject;

import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class MainActivity extends Activity {
    private static final String TRUSTED_SCHEME = "https";
    private static final String TRUSTED_HOST = "maxhenneberg.github.io";
    private static final String TRUSTED_PATH = "/travel-app/";

    private final ArrayDeque<JSONObject> pendingDeliveries = new ArrayDeque<>();
    private final ExecutorService fileExecutor = Executors.newSingleThreadExecutor();
    private WebView webView;
    private boolean trustedPageReady;
    private boolean fallbackShown;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        configureWebView();
        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(BuildConfig.APP_URL);
        }
        consumeIntent(getIntent());
    }

    private void configureWebView() {
        webView = new WebView(this);
        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        WebView.setWebContentsDebuggingEnabled(BuildConfig.DEBUG);
        webView.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                if (trusted(request.getUrl())) return false;
                openExternal(request.getUrl());
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, Bitmap favicon) {
                trustedPageReady = false;
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                trustedPageReady = trusted(Uri.parse(url));
                deliverPending();
            }

            @Override
            public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError error) {
                if (request.isForMainFrame() && !view.canGoBack()) showBrowserFallback();
            }
        });
        setContentView(webView);
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        consumeIntent(intent);
    }

    private void consumeIntent(Intent source) {
        if (source == null || !Intent.ACTION_VIEW.equals(source.getAction())) return;
        setIntent(new Intent(this, MainActivity.class).setAction(Intent.ACTION_MAIN));
        fileExecutor.execute(() -> {
            JSONObject delivery = TrailbookIntentReader.read(getContentResolver(), source);
            if (delivery == null) return;
            runOnUiThread(() -> {
                pendingDeliveries.add(delivery);
                deliverPending();
            });
        });
    }

    private void deliverPending() {
        if (!trustedPageReady || pendingDeliveries.isEmpty()) return;
        while (!pendingDeliveries.isEmpty()) {
            JSONObject payload = pendingDeliveries.removeFirst();
            String script = "(() => { const payload = " + payload + "; "
                    + "if (typeof window.trailbookReceiveAndroidOpen === 'function') "
                    + "window.trailbookReceiveAndroidOpen(payload); else "
                    + "(window.__trailbookAndroidOpenQueue ||= []).push(payload); })();";
            webView.evaluateJavascript(script, null);
        }
    }

    private static boolean trusted(Uri uri) {
        if (uri == null || !TRUSTED_SCHEME.equals(uri.getScheme()) || !TRUSTED_HOST.equals(uri.getHost())) return false;
        String path = uri.getPath();
        return path != null && (path.equals(TRUSTED_PATH.substring(0, TRUSTED_PATH.length() - 1)) || path.startsWith(TRUSTED_PATH));
    }

    private void openExternal(Uri uri) {
        if (uri == null || !"https".equals(uri.getScheme())) return;
        startActivity(new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE));
    }

    private void showBrowserFallback() {
        if (fallbackShown || isFinishing()) return;
        fallbackShown = true;
        new AlertDialog.Builder(this)
                .setTitle("Trailbook could not open")
                .setMessage("Open the installable Trailbook PWA in your browser instead. The file was not imported.")
                .setNegativeButton("Stay here", (dialog, which) -> fallbackShown = false)
                .setPositiveButton("Open browser", (dialog, which) -> openExternal(Uri.parse(BuildConfig.APP_URL)))
                .show();
    }

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        webView.saveState(outState);
        super.onSaveInstanceState(outState);
    }

    @Override
    public void onBackPressed() {
        if (webView.canGoBack()) webView.goBack();
        else super.onBackPressed();
    }

    @Override
    protected void onDestroy() {
        fileExecutor.shutdownNow();
        webView.destroy();
        super.onDestroy();
    }
}
