package com.jcsh3132.jeago;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.graphics.Bitmap;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Message;
import android.view.Gravity;
import android.view.View;
import android.view.WindowInsets;
import android.webkit.*;
import android.widget.*;

/** Same-origin app host. Authentication stays in the site's HttpOnly cookies. */
public final class MainActivity extends Activity {
    private LinearLayout root;
    private Page mainPage;
    private Page loginPage;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setBackgroundColor(Color.WHITE);
        // Android 15 enforces edge-to-edge. Keep system bars and keyboard off the form.
        if (Build.VERSION.SDK_INT >= 30) {
            getWindow().setDecorFitsSystemWindows(false);
            getWindow().setNavigationBarColor(Color.WHITE);
        }
        root.setOnApplyWindowInsetsListener((view, insets) -> {
            if (Build.VERSION.SDK_INT >= 30) {
                android.view.WindowInsetsController controller = view.getWindowInsetsController();
                if (controller != null) controller.setSystemBarsAppearance(
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS,
                    android.view.WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS
                        | android.view.WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
                android.graphics.Insets safe = insets.getInsets(WindowInsets.Type.systemBars()
                    | WindowInsets.Type.displayCutout() | WindowInsets.Type.ime());
                view.setPadding(safe.left, safe.top, safe.right, safe.bottom);
                return WindowInsets.CONSUMED;
            }
            return insets; // Older Android fits system bars; adjustResize handles the keyboard.
        });
        setContentView(root);
        CookieManager.getInstance().setAcceptCookie(true);
        mainPage = new Page(false);
        root.addView(mainPage.container, fill());
        if (state == null || mainPage.web.restoreState(state) == null) mainPage.web.loadUrl(NavigationPolicy.SITE);
        root.requestApplyInsets();
        if (Build.VERSION.SDK_INT >= 33) getOnBackInvokedDispatcher().registerOnBackInvokedCallback(
            android.window.OnBackInvokedDispatcher.PRIORITY_DEFAULT, this::navigateBack);
    }

    private LinearLayout.LayoutParams fill() { return new LinearLayout.LayoutParams(-1, 0, 1); }

    private final class Page {
        final LinearLayout container = new LinearLayout(MainActivity.this);
        final WebView web = new WebView(MainActivity.this);
        final ProgressBar progress = new ProgressBar(MainActivity.this, null, android.R.attr.progressBarStyleHorizontal);
        final LinearLayout error = new LinearLayout(MainActivity.this);
        String lastUrl = NavigationPolicy.SITE;

        Page(boolean popup) {
            container.setOrientation(LinearLayout.VERTICAL);
            if (popup) {
                Button close = new Button(MainActivity.this);
                close.setText("이전 작업으로 돌아가기");
                close.setOnClickListener(view -> closeLogin());
                container.addView(close, new LinearLayout.LayoutParams(-1, -2));
            }
            container.addView(progress, new LinearLayout.LayoutParams(-1, dp(3)));
            FrameLayout content = new FrameLayout(MainActivity.this);
            container.addView(content, fill());
            content.addView(web, new FrameLayout.LayoutParams(-1, -1));
            error.setOrientation(LinearLayout.VERTICAL);
            error.setGravity(Gravity.CENTER);
            error.setPadding(dp(24), dp(24), dp(24), dp(24));
            error.setBackgroundColor(Color.WHITE);
            TextView message = new TextView(MainActivity.this);
            message.setText("화면을 불러올 수 없습니다.\n인터넷 연결을 확인한 뒤 다시 시도해 주세요.");
            message.setTextColor(Color.rgb(16, 43, 54));
            message.setTextSize(17);
            message.setGravity(Gravity.CENTER);
            error.addView(message);
            Button retry = new Button(MainActivity.this);
            retry.setText("다시 시도");
            // Never resubmit a stock mutation POST when recovering a failed page load.
            retry.setOnClickListener(view -> web.loadUrl(lastUrl));
            error.addView(retry);
            error.setVisibility(View.GONE);
            content.addView(error, new FrameLayout.LayoutParams(-1, -1));
            WebSettings settings = web.getSettings();
            settings.setJavaScriptEnabled(true);
            settings.setDomStorageEnabled(true);
            settings.setUseWideViewPort(true);
            settings.setLoadWithOverviewMode(true);
            settings.setAllowFileAccess(false);
            settings.setAllowContentAccess(false);
            settings.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
            settings.setSupportMultipleWindows(true);
            settings.setJavaScriptCanOpenWindowsAutomatically(false);
            if (Build.VERSION.SDK_INT >= 26) settings.setSafeBrowsingEnabled(true);
            CookieManager.getInstance().setAcceptThirdPartyCookies(web, false);
            web.setWebViewClient(new WebViewClient() {
                @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
                    return route(request.getUrl().toString(), request.isForMainFrame(), request.hasGesture());
                }
                @Override public boolean shouldOverrideUrlLoading(WebView view, String url) {
                    return route(url, true, true);
                }
                @Override public void onPageStarted(WebView view, String url, Bitmap icon) {
                    if (!NavigationPolicy.isInternal(url)) { view.stopLoading(); showError(); return; }
                    lastUrl = url;
                    error.setVisibility(View.GONE);
                    progress.setVisibility(View.VISIBLE);
                }
                @Override public void onPageFinished(WebView view, String url) {
                    progress.setVisibility(View.GONE);
                    CookieManager.getInstance().flush();
                }
                @Override public void onReceivedError(WebView view, WebResourceRequest request, WebResourceError failure) {
                    if (request.isForMainFrame()) showError();
                }
                @Override public void onReceivedHttpError(WebView view, WebResourceRequest request, WebResourceResponse response) {
                    if (request.isForMainFrame() && response.getStatusCode() >= 500) showError();
                }
                // Default SSL handling cancels invalid certificates. Never bypass TLS checks.
            });
            web.setWebChromeClient(new WebChromeClient() {
                @Override public void onProgressChanged(WebView view, int value) {
                    progress.setProgress(value);
                    if (value == 100) progress.setVisibility(View.GONE);
                }
                @Override public boolean onCreateWindow(WebView view, boolean dialog, boolean userGesture, Message result) {
                    if (!userGesture || popup || loginPage != null || !NavigationPolicy.isInternal(view.getUrl())) return false;
                    // Preserve the original form and pending request while re-authenticating.
                    loginPage = new Page(true);
                    mainPage.container.setVisibility(View.GONE);
                    root.addView(loginPage.container, fill());
                    WebView.WebViewTransport transport = (WebView.WebViewTransport) result.obj;
                    transport.setWebView(loginPage.web);
                    result.sendToTarget();
                    return true;
                }
                @Override public void onCloseWindow(WebView view) {
                    if (loginPage != null && loginPage.web == view) closeLogin();
                }
                // Default WebChromeClient dialogs preserve confirm() used by inventory forms.
            });
        }

        boolean route(String url, boolean mainFrame, boolean userGesture) {
            if (NavigationPolicy.isInternal(url)) return false;
            // External sites must display browser identity instead of app chrome.
            if (mainFrame && userGesture && NavigationPolicy.isExternalHttps(url)) {
                try { startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(url))); }
                catch (ActivityNotFoundException failure) {
                    Toast.makeText(MainActivity.this, "링크를 열 수 있는 브라우저가 없습니다.", Toast.LENGTH_LONG).show();
                }
            }
            return true;
        }
        void showError() { progress.setVisibility(View.GONE); error.setVisibility(View.VISIBLE); }
    }

    private void closeLogin() {
        if (loginPage == null) return;
        CookieManager.getInstance().flush();
        root.removeView(loginPage.container);
        loginPage.web.destroy();
        loginPage = null;
        mainPage.container.setVisibility(View.VISIBLE);
        mainPage.web.requestFocus();
    }
    private void navigateBack() {
        if (loginPage != null) { closeLogin(); return; }
        if (mainPage.web.canGoBack()) mainPage.web.goBack(); else finish();
    }
    @Override public void onBackPressed() { navigateBack(); }
    @Override protected void onSaveInstanceState(Bundle state) {
        mainPage.web.saveState(state);
        super.onSaveInstanceState(state);
    }
    @Override protected void onPause() {
        CookieManager.getInstance().flush();
        mainPage.web.onPause();
        if (loginPage != null) loginPage.web.onPause();
        super.onPause();
    }
    @Override protected void onResume() {
        super.onResume();
        if (mainPage != null) mainPage.web.onResume();
        if (loginPage != null) loginPage.web.onResume();
    }
    @Override protected void onDestroy() {
        if (loginPage != null) loginPage.web.destroy();
        if (mainPage != null) mainPage.web.destroy();
        super.onDestroy();
    }
    private int dp(int value) { return Math.round(value * getResources().getDisplayMetrics().density); }
}
