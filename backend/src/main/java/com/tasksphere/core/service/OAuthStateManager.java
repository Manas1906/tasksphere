package com.tasksphere.core.service;

import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.http.ResponseCookie;
import org.springframework.http.HttpHeaders;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.SecureRandom;

@Service
public class OAuthStateManager {

    private final SecureRandom secureRandom = new SecureRandom();

    /**
     * Generates a cryptographically secure 256-bit entropy state token.
     * Uses a 32-byte (256-bit) buffer represented as a 64-character hex string.
     */
    public String generateStateToken() {
        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);
        
        StringBuilder hexString = new StringBuilder();
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }
        return hexString.toString();
    }

    /**
     * Serializes the state token into a secure, HttpOnly cookie on the response.
     */
    public void createStateCookie(HttpServletResponse response, String state) {
        ResponseCookie cookie = ResponseCookie.from("oauth_state", state)
            .httpOnly(true)
            .secure(true) // Forces SSL/TLS transmission
            .path("/")
            .maxAge(600) // 10 minutes Time-to-Live (TTL)
            .sameSite("Lax") // Prevents cross-site cookie leakage
            .build();

        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }

    /**
     * Extracts and validates the state parameter using a constant-time cryptographic comparison.
     */
    public boolean verifyState(HttpServletRequest request, String receivedState) {
        if (receivedState == null || receivedState.trim().isEmpty()) {
            return false;
        }

        String storedState = null;
        Cookie[] cookies = request.getCookies();
        if (cookies != null) {
            for (Cookie cookie : cookies) {
                if ("oauth_state".equals(cookie.getName())) {
                    storedState = cookie.getValue();
                    break;
                }
            }
        }

        if (storedState == null || storedState.trim().isEmpty()) {
            return false;
        }

        // Timing-safe constant-time string comparison using standard JDK MessageDigest.isEqual
        byte[] a = storedState.getBytes(StandardCharsets.UTF_8);
        byte[] b = receivedState.getBytes(StandardCharsets.UTF_8);

        return MessageDigest.isEqual(a, b);
    }

    /**
     * Clears the state cookie from the client browser after consumption.
     */
    public void clearStateCookie(HttpServletResponse response) {
        ResponseCookie cookie = ResponseCookie.from("oauth_state", "")
            .httpOnly(true)
            .secure(true)
            .path("/")
            .maxAge(0) // Expire immediately
            .sameSite("Lax")
            .build();

        response.addHeader(HttpHeaders.SET_COOKIE, cookie.toString());
    }
}
