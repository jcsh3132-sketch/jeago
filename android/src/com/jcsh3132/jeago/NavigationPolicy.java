package com.jcsh3132.jeago;

import java.net.URI;
import java.net.URISyntaxException;

/** Reject lookalike hosts, credentials, and non-HTTPS schemes in the app. */
final class NavigationPolicy {
    static final String SITE = "https://jeago.vercel.app/";

    static boolean isInternal(String url) {
        URI uri = parseHttps(url);
        return uri != null && "jeago.vercel.app".equalsIgnoreCase(uri.getHost())
            && (uri.getPort() == -1 || uri.getPort() == 443);
    }

    static boolean isExternalHttps(String url) { return parseHttps(url) != null && !isInternal(url); }

    private static URI parseHttps(String url) {
        if (url == null || url.indexOf('\\') >= 0) return null;
        try {
            URI uri = new URI(url);
            return "https".equalsIgnoreCase(uri.getScheme()) && uri.getHost() != null
                && uri.getRawUserInfo() == null ? uri : null;
        } catch (URISyntaxException failure) { return null; }
    }
}
