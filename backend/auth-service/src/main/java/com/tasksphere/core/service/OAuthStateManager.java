package com.tasksphere.core.service;

import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.security.SecureRandom;
import java.util.concurrent.ConcurrentHashMap;

/**
 * Server-side OAuth CSRF state manager.
 *
 * <p>Prior implementation stored the state token in an HttpOnly cookie, which
 * failed reliably in cloud/proxy deployments (e.g., Render.com) because the
 * Set-Cookie header is sometimes stripped or not forwarded during browser
 * redirects through reverse proxies.</p>
 *
 * <p>This implementation stores the state token in a {@link ConcurrentHashMap}
 * with a per-entry expiry timestamp. No cookies are set or read. The flow is:</p>
 * <ol>
 *   <li>{@link #generateStateToken()} creates a 64-char hex token, stores it
 *       with an expiry of {@value #STATE_TTL_MS} ms, and returns it.</li>
 *   <li>The controller embeds the token in the OAuth redirect URL as the
 *       {@code state} query parameter — the provider echoes it back unchanged.</li>
 *   <li>{@link #verifyState} atomically removes the token from the store and
 *       validates it (single-use, replay-safe, time-limited).</li>
 * </ol>
 *
 * <p>{@link #createStateCookie} and {@link #clearStateCookie} are retained as
 * no-ops for API compatibility; no cookies are used.</p>
 */
@Service
public class OAuthStateManager {

    private static final Logger log = LoggerFactory.getLogger(OAuthStateManager.class);

    private static final long STATE_TTL_MS = 600_000L; // 10 minutes

    private final SecureRandom secureRandom = new SecureRandom();

    /**
     * ConcurrentHashMap: stateToken → expiry epoch ms.
     * ConcurrentHashMap guarantees thread-safe access for multi-threaded servers.
     */
    private final ConcurrentHashMap<String, Long> stateStore = new ConcurrentHashMap<>();

    /**
     * Generates a cryptographically secure 256-bit state token and stores
     * it server-side with a 10-minute TTL.
     *
     * <p>Performs lazy cleanup of expired entries on each invocation to prevent
     * unbounded growth of the map under high concurrency.</p>
     */
    public String generateStateToken() {
        // Lazy TTL-based cleanup — remove all entries whose expiry has passed
        final long now = System.currentTimeMillis();
        stateStore.entrySet().removeIf(entry -> now > entry.getValue());

        byte[] bytes = new byte[32];
        secureRandom.nextBytes(bytes);

        StringBuilder hexString = new StringBuilder(64);
        for (byte b : bytes) {
            String hex = Integer.toHexString(0xff & b);
            if (hex.length() == 1) {
                hexString.append('0');
            }
            hexString.append(hex);
        }

        String state = hexString.toString();
        stateStore.put(state, now + STATE_TTL_MS);
        return state;
    }

    /**
     * No-op — state is stored server-side, no cookie is required.
     * Retained for API compatibility with {@code FederatedAuthController}.
     */
    public void createStateCookie(HttpServletRequest request, HttpServletResponse response, String state) {
        // Server-side ConcurrentHashMap replaces cookie-based state storage.
        // This method is intentionally a no-op.
    }

    /**
     * Validates and atomically consumes the state token.
     *
     * <p>Uses {@link ConcurrentHashMap#remove(Object)} which is atomic:
     * the token is fetched and deleted in a single operation, guaranteeing
     * single-use (replay-protection) without an explicit lock.</p>
     *
     * @param request       the HTTP request (unused; retained for API compat)
     * @param receivedState the state value returned by the OAuth provider
     * @return {@code true} if the state exists in the store and has not expired
     */
    public boolean verifyState(HttpServletRequest request, String receivedState) {
        if (receivedState == null || receivedState.trim().isEmpty()) {
            return false;
        }

        // Atomic remove: returns null if key was not present
        Long expiry = stateStore.remove(receivedState.trim());
        if (expiry == null) {
            return false;
        }

        return System.currentTimeMillis() <= expiry;
    }

    /**
     * No-op — state is consumed atomically inside {@link #verifyState}.
     * Retained for API compatibility with {@code FederatedAuthController}.
     */
    public void clearStateCookie(HttpServletRequest request, HttpServletResponse response) {
        // State is single-use and consumed in verifyState().
        // This method is intentionally a no-op.
    }
}
