package com.animestream.app;

import android.annotation.SuppressLint;
import android.app.Activity;
import android.graphics.Color;
import android.os.Bundle;
import android.util.Log;
import android.view.View;
import android.view.WindowManager;
import android.webkit.ConsoleMessage;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.FrameLayout;

import androidx.webkit.WebViewAssetLoader;

public class MainActivity extends Activity {
    private static final String TAG = "AnimeStream";
    private static final String APP_URL =
            "https://appassets.androidplatform.net/assets/www/index.html";

    private WebView webView;
    private View customView;
    private WebChromeClient.CustomViewCallback customViewCallback;

    @SuppressLint("SetJavaScriptEnabled")
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        getWindow().setStatusBarColor(Color.parseColor("#0a0a0f"));
        getWindow().setNavigationBarColor(Color.parseColor("#0a0a0f"));

        webView = new WebView(this);
        webView.setBackgroundColor(Color.parseColor("#0a0a0f"));
        setContentView(webView);

        WebSettings settings = webView.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setDatabaseEnabled(true);
        settings.setMediaPlaybackRequiresUserGesture(false);
        settings.setAllowFileAccess(true);
        settings.setAllowContentAccess(true);
        settings.setCacheMode(WebSettings.LOAD_DEFAULT);
        settings.setMixedContentMode(WebSettings.MIXED_CONTENT_ALWAYS_ALLOW);

        // Fallback para WebViews antigos que ainda carregam via file://
        settings.setAllowFileAccessFromFileURLs(true);
        settings.setAllowUniversalAccessFromFileURLs(true);

        WebViewAssetLoader assetLoader = new WebViewAssetLoader.Builder()
                .addPathHandler("/assets/", new WebViewAssetLoader.AssetsPathHandler(this))
                .build();

        webView.setWebViewClient(new WebViewClient() {
            @Override
            public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
                WebResourceResponse response = assetLoader.shouldInterceptRequest(request.getUrl());
                return response != null ? response : super.shouldInterceptRequest(view, request);
            }

            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                String url = request.getUrl().toString();
                return !url.startsWith("https://appassets.androidplatform.net/")
                        && !url.startsWith("http://")
                        && !url.startsWith("https://");
            }
        });

        webView.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onConsoleMessage(ConsoleMessage consoleMessage) {
                Log.d(TAG, consoleMessage.message() + " ("
                        + consoleMessage.sourceId() + ":"
                        + consoleMessage.lineNumber() + ")");
                return true;
            }

            @Override
            public void onShowCustomView(View view, CustomViewCallback callback) {
                if (customView != null) {
                    callback.onCustomViewHidden();
                    return;
                }
                customView = view;
                customViewCallback = callback;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.addView(customView, new FrameLayout.LayoutParams(
                        FrameLayout.LayoutParams.MATCH_PARENT,
                        FrameLayout.LayoutParams.MATCH_PARENT
                ));
                webView.setVisibility(View.GONE);
                getWindow().addFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
            }

            @Override
            public void onHideCustomView() {
                if (customView == null) return;
                FrameLayout decor = (FrameLayout) getWindow().getDecorView();
                decor.removeView(customView);
                customView = null;
                webView.setVisibility(View.VISIBLE);
                getWindow().clearFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN);
                if (customViewCallback != null) customViewCallback.onCustomViewHidden();
            }
        });

        webView.loadUrl(APP_URL);
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        if (customView != null) {
            if (webView.getWebChromeClient() != null) {
                webView.getWebChromeClient().onHideCustomView();
            }
            return;
        }
        webView.evaluateJavascript(
                "(function(){if(typeof TvPlayer!=='undefined'&&TvPlayer.isFullscreen&&TvPlayer.isFullscreen()){" +
                "TvPlayer.exitFullscreen();return true;}" +
                "var p=document.getElementById('playerSection');" +
                "if(p&&!p.hidden){p.hidden=true;return true;}" +
                "var d=document.getElementById('detailSection');" +
                "if(d&&!d.hidden){document.getElementById('homeBtn').click();return true;}" +
                "var s=document.getElementById('searchSection');" +
                "if(s&&!s.hidden){document.getElementById('homeBtn').click();return true;}" +
                "return false;})()",
                value -> {
                    if ("true".equals(value)) return;
                    if (webView.canGoBack()) webView.goBack();
                    else finish();
                }
        );
    }

    @Override
    protected void onDestroy() {
        if (webView != null) {
            webView.loadUrl("about:blank");
            webView.destroy();
        }
        super.onDestroy();
    }
}