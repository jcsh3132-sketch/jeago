package com.jcsh3132.jeago;

/** Runs on the build JDK without an Android device. */
public final class NavigationPolicyTest {
    public static void main(String[] args) {
        String[] allowed = { NavigationPolicy.SITE, "https://jeago.vercel.app/signup",
            "https://JEAGO.vercel.app:443/items?q=%ED%95%9C%EA%B8%80#stock",
            "https://jeago.vercel.app/?next=https://example.com" };
        for (String url : allowed) {
            check(NavigationPolicy.isInternal(url), url);
            check(!NavigationPolicy.isExternalHttps(url), url);
        }
        String[] blocked = { null, "", "http://jeago.vercel.app", "javascript:alert(1)",
            "file:///data/local/a.html", "content://example/1", "intent://example",
            "https://jeago.vercel.app@evil.example", "https://evil.example@jeago.vercel.app",
            "https://jeago.vercel.app\\@evil.example", "//jeago.vercel.app/",
            "https://jeago.vercel.app/%ZZ" };
        for (String url : blocked) {
            check(!NavigationPolicy.isInternal(url), url);
            check(!NavigationPolicy.isExternalHttps(url), url);
        }
        String[] external = { "https://example.com/", "https://jeago.vercel.app.evil.example/",
            "https://jeago.vercel.app:444/", "https://jeago.vercel.app./" };
        for (String url : external) {
            check(!NavigationPolicy.isInternal(url), url);
            check(NavigationPolicy.isExternalHttps(url), url);
        }
        System.out.println("NavigationPolicy: 20 URL cases passed.");
    }
    private static void check(boolean result, String url) {
        if (!result) throw new AssertionError("Unexpected navigation policy: " + url);
    }
}
