package com.tasksphere.core.controller;

import com.google.api.client.googleapis.auth.oauth2.GoogleIdToken;
import com.tasksphere.core.config.JwtTokenProvider;
import com.tasksphere.core.model.OAuthAccount;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.OAuthAccountRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.GitHubOAuthService;
import com.tasksphere.core.service.GoogleTokenVerifierService;
import com.tasksphere.core.service.OAuthStateManager;
import com.tasksphere.core.service.UserApprovalService;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class FederatedAuthController {

    private static final Logger log = LoggerFactory.getLogger(FederatedAuthController.class);

    private final OAuthStateManager stateManager;
    private final GoogleTokenVerifierService googleTokenVerifierService;
    private final GitHubOAuthService githubOAuthService;
    private final OAuthAccountRepository oauthAccountRepository;
    private final UserSessionRepository userRepository;
    private final JwtTokenProvider tokenProvider;
    private final UserApprovalService userApprovalService;
    private final RestTemplate restTemplate = new RestTemplate();

    @Value("${security.google.client-id:}")
    private String googleClientId;

    @Value("${security.google.client-secret:}")
    private String googleClientSecret;

    @Value("${security.google.redirect-uri:http://localhost:8080/api/auth/google/callback}")
    private String googleRedirectUri;

    @Value("${security.github.client-id:}")
    private String githubClientId;

    @Value("${security.github.redirect-uri:http://localhost:8080/api/auth/github/callback}")
    private String githubRedirectUri;

    @Value("${security.frontend.url:http://localhost:5173}")
    private String frontendUrl;

    private String getCleanGoogleClientId() {
        return sanitize(googleClientId);
    }

    private String getCleanGoogleClientSecret() {
        return sanitize(googleClientSecret);
    }

    private String getCleanGithubClientId() {
        return sanitize(githubClientId);
    }

    private String sanitize(String val) {
        if (val == null) return "";
        String trimmed = val.trim();
        if (trimmed.startsWith("\"") && trimmed.endsWith("\"") && trimmed.length() >= 2) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        if (trimmed.startsWith("'") && trimmed.endsWith("'") && trimmed.length() >= 2) {
            trimmed = trimmed.substring(1, trimmed.length() - 1);
        }
        return trimmed.trim();
    }

    public FederatedAuthController(OAuthStateManager stateManager,
                                   GoogleTokenVerifierService googleTokenVerifierService,
                                   GitHubOAuthService githubOAuthService,
                                   OAuthAccountRepository oauthAccountRepository,
                                   UserSessionRepository userRepository,
                                   JwtTokenProvider tokenProvider,
                                   UserApprovalService userApprovalService) {
        this.stateManager = stateManager;
        this.googleTokenVerifierService = googleTokenVerifierService;
        this.githubOAuthService = githubOAuthService;
        this.oauthAccountRepository = oauthAccountRepository;
        this.userRepository = userRepository;
        this.tokenProvider = tokenProvider;
        this.userApprovalService = userApprovalService;
    }

    /**
     * Builds the OAuth callback URI dynamically from the incoming request.
     *
     * <p>Uses {@code X-Forwarded-Proto} (for scheme) and {@code Host} header
     * (for hostname) so the URI is correct for both local development and
     * production reverse-proxy deployments (e.g. Render.com, Railway).
     * This eliminates the need for GOOGLE_REDIRECT_URI / GITHUB_REDIRECT_URI
     * environment variables.</p>
     *
     * <p><strong>Important:</strong> The returned URI must be registered in the
     * OAuth provider's allowed-redirect-URIs list (Google Cloud Console /
     * GitHub OAuth App settings).</p>
     */
    private String buildCallbackUri(HttpServletRequest request, String path) {
        // Resolve scheme: trust X-Forwarded-Proto from reverse proxy first
        String proto = request.getHeader("X-Forwarded-Proto");
        if (proto != null && proto.contains(",")) {
            proto = proto.split(",")[0].trim(); // take first value if chained
        }
        if (proto == null || proto.isEmpty()) {
            proto = request.isSecure() ? "https" : "http";
        }

        // Resolve host: Host header reflects the public-facing hostname after proxy
        String host = request.getHeader("Host");
        if (host == null || host.isEmpty()) {
            host = request.getServerName();
            int port = request.getServerPort();
            boolean isDefault = ("https".equals(proto) && port == 443)
                    || ("http".equals(proto) && port == 80);
            if (!isDefault && port > 0) {
                host += ":" + port;
            }
        }

        String callbackUri = proto + "://" + host + path;
        log.debug("Built dynamic callback URI: {}", callbackUri);
        return callbackUri;
    }

    /**
     * Browser Redirect Login Endpoint for Google OAuth.
     */
    @GetMapping("/google/login")
    public void googleLogin(HttpServletRequest request, HttpServletResponse response) throws IOException {
        log.info("Initiating Google OAuth login flow.");
        String state = stateManager.generateStateToken();
        stateManager.createStateCookie(request, response, state);

        // Build redirect URI dynamically so it works on localhost AND production
        // without requiring GOOGLE_REDIRECT_URI to be set as an environment variable.
        String dynamicRedirectUri = buildCallbackUri(request, "/api/auth/google/callback");
        String encodedRedirectUri = java.net.URLEncoder.encode(dynamicRedirectUri, "UTF-8");

        String redirectUrl = String.format(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=openid%%20email%%20profile&state=%s",
                getCleanGoogleClientId(),
                encodedRedirectUri,
                state
        );
        log.info("Redirecting browser to Google OAuth authorization endpoint: {}", redirectUrl);
        response.sendRedirect(redirectUrl);
    }

    /**
     * Browser Redirect Callback Endpoint for Google OAuth.
     * Exchanges code for ID Token and processes standard identity reconciliation.
     */
    @GetMapping("/google/callback")
    public void googleRedirectCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        log.info("Received Google OAuth redirect callback code parameter presence: {}, state: {}", code != null, state);
        try {
            // 1. Timing-safe CSRF state validation
            boolean isStateValid = stateManager.verifyState(request, state);
            if (!isStateValid) {
                log.error("Google state validation failed for state: {}", state);
                throw new SecurityException("Google state validation failed: State parameter mismatch or expired session.");
            }
            log.info("Google state token verified successfully.");
            stateManager.clearStateCookie(request, response);

            if (code == null || code.trim().isEmpty()) {
                throw new IllegalArgumentException("Google authorization code parameter is missing.");
            }

            // 2. Exchange code for tokens at https://oauth2.googleapis.com/token
            // redirect_uri must EXACTLY match the one sent in the authorization request.
            String dynamicRedirectUri = buildCallbackUri(request, "/api/auth/google/callback");
            String tokenUrl = "https://oauth2.googleapis.com/token";
            Map<String, String> requestPayload = new HashMap<>();
            requestPayload.put("client_id", getCleanGoogleClientId());
            requestPayload.put("client_secret", getCleanGoogleClientSecret());
            requestPayload.put("code", code.trim());
            requestPayload.put("grant_type", "authorization_code");
            requestPayload.put("redirect_uri", dynamicRedirectUri);

            log.info("Exchanging Google authorization code for tokens.");
            Map<String, Object> tokenResponse = restTemplate.postForObject(tokenUrl, requestPayload, Map.class);
            
            if (tokenResponse == null || !tokenResponse.containsKey("id_token")) {
                log.error("No id_token in Google token exchange response.");
                throw new SecurityException("Google OAuth token exchange failed: No ID Token returned.");
            }

            String idToken = (String) tokenResponse.get("id_token");

            // 3. Cryptographic and claim validation of ID Token
            log.info("Verifying Google ID Token.");
            GoogleIdToken.Payload googleProfile = googleTokenVerifierService.verifyToken(idToken);
            String externalUserId = googleProfile.getSubject();
            String email = googleProfile.getEmail().toLowerCase().trim();
            String name = (String) googleProfile.get("name");
            String picture = (String) googleProfile.get("picture");
            log.info("Google profile details: subject={}, email={}, name={}", externalUserId, email, name);

            // 4. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("google", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                log.info("Found existing Google linked user account: userId={}", userId);
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> email.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
                    log.info("Found existing user by email to link Google account: userId={}", user.getId());
                } else {
                    isNewSocial = true;
                    // Create new user profile
                    String username = email.split("@")[0].toLowerCase().trim();
                    Optional<UserSession> userWithUsername = userRepository.findByUsername(username);
                    if (userWithUsername.isPresent()) {
                        username = username + "_" + UUID.randomUUID().toString().substring(0, 4);
                    }

                    user = UserSession.builder()
                            .username(username)
                            .role("DEVELOPER")
                            .status("ONBOARDING")
                            .build();
                    user.packMetadata(
                            picture != null ? picture : "https://api.dicebear.com/7.x/bottts/svg?seed=" + username,
                            email,
                            null, // Null password indicates social-only profile
                            false
                    );
                    user = userRepository.save(user);
                    log.info("Created new user profile: userId={}, username={}", user.getId(), username);
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("google")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
                log.info("Successfully linked Google OAuth credentials to userId={}", user.getId());
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());

            // Redirect back to frontend overlay with URL-encoded query parameters.
            // Avatar URLs (e.g. Google profile pictures) and emails can contain '=',
            // '&', '+', and '/' characters that corrupt browser URL parsing when left
            // unencoded.  The JWT itself is already base64url-safe (no encoding needed).
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            String redirectDest = cleanFrontend
                    + "?token=" + jwt
                    + "&username=" + java.net.URLEncoder.encode(user.getUsername() != null ? user.getUsername() : "", "UTF-8")
                    + "&role=" + java.net.URLEncoder.encode(user.getRole() != null ? user.getRole() : "DEVELOPER", "UTF-8")
                    + "&email=" + java.net.URLEncoder.encode(user.getExtractedEmail() != null ? user.getExtractedEmail() : "", "UTF-8")
                    + "&avatar=" + java.net.URLEncoder.encode(user.getPureAvatarUrl() != null ? user.getPureAvatarUrl() : "", "UTF-8")
                    + "&new_social=" + isNewSocial;
            log.info("Google authentication successful. Redirecting to frontend.");
            response.sendRedirect(redirectDest);

        } catch (Exception ex) {
            log.error("Google OAuth callback processing error: {}", ex.getMessage(), ex);
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            response.sendRedirect(cleanFrontend + "?error=" + java.net.URLEncoder.encode(ex.getMessage(), "UTF-8"));
        }
    }

    /**
     * Google One-Tap / POST Callback Endpoint.
     * Receives OIDC ID Token credential and g_csrf_token to execute verification and login reconciliation.
     */
    @PostMapping("/google/callback")
    public ResponseEntity<?> googleCallback(
            @RequestBody Map<String, String> payload,
            HttpServletRequest request) {
        log.info("Received Google One-Tap/POST login callback request.");
        try {
            String idToken = payload.get("credential");
            String csrfBody = payload.get("g_csrf_token");

            // Extract CSRF cookie
            String csrfCookie = null;
            Cookie[] cookies = request.getCookies();
            if (cookies != null) {
                for (Cookie cookie : cookies) {
                    if ("g_csrf_token".equals(cookie.getName())) {
                        csrfCookie = cookie.getValue();
                        break;
                    }
                }
            }

            // 1. Double-Submit Cookie CSRF check
            boolean csrfValid = googleTokenVerifierService.verifyCsrf(csrfCookie, csrfBody);
            if (!csrfValid) {
                log.error("Google One-Tap CSRF validation failed. csrfCookie presence: {}, csrfBody presence: {}", csrfCookie != null, csrfBody != null);
                Map<String, String> err = new HashMap<>();
                err.put("error", "CSRF validation failed: Token mismatch or missing credentials.");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(err);
            }
            log.info("Google One-Tap CSRF validation passed.");

            // 2. Cryptographic and claim validation
            log.info("Verifying Google One-Tap ID Token.");
            GoogleIdToken.Payload googleProfile = googleTokenVerifierService.verifyToken(idToken);
            String externalUserId = googleProfile.getSubject();
            String email = googleProfile.getEmail().toLowerCase().trim();
            String name = (String) googleProfile.get("name");
            String picture = (String) googleProfile.get("picture");
            log.info("Google One-Tap profile details: subject={}, email={}, name={}", externalUserId, email, name);

            // 3. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("google", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                log.info("Found existing Google linked user account (One-Tap): userId={}", userId);
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> email.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
                    log.info("Found existing user by email to link Google One-Tap account: userId={}", user.getId());
                } else {
                    isNewSocial = true;
                    // Create new user profile
                    String username = email.split("@")[0].toLowerCase().trim();
                    Optional<UserSession> userWithUsername = userRepository.findByUsername(username);
                    if (userWithUsername.isPresent()) {
                        username = username + "_" + UUID.randomUUID().toString().substring(0, 4);
                    }

                    user = UserSession.builder()
                            .username(username)
                            .role("DEVELOPER")
                            .status("ONBOARDING")
                            .build();
                    user.packMetadata(
                            picture != null ? picture : "https://api.dicebear.com/7.x/bottts/svg?seed=" + username,
                            email,
                            null, // Null password indicates social-only profile
                            false
                    );
                    user = userRepository.save(user);
                    log.info("Created new user profile for One-Tap: userId={}, username={}", user.getId(), username);
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("google")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
                log.info("Successfully linked Google One-Tap credentials to userId={}", user.getId());
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());
            log.info("Google One-Tap login successful for user email={}.", user.getExtractedEmail());

            Map<String, Object> response = new HashMap<>();
            response.put("success", true);
            response.put("token", jwt);
            response.put("username", user.getUsername());
            response.put("role", user.getRole());
            response.put("avatarUrl", user.getPureAvatarUrl());
            response.put("email", user.getExtractedEmail());
            response.put("new_social", isNewSocial);

            return ResponseEntity.ok(response);
        } catch (Exception ex) {
            log.error("Google One-Tap authentication failure: {}", ex.getMessage(), ex);
            Map<String, String> err = new HashMap<>();
            err.put("error", "Google authentication rejected: " + ex.getMessage());
            return ResponseEntity.status(HttpStatus.UNAUTHORIZED).body(err);
        }
    }

    /**
     * Generates state, sets secure cookie, and redirects user's browser to GitHub Authorization page.
     */
    @GetMapping("/github/login")
    public void githubLogin(HttpServletRequest request, HttpServletResponse response) throws IOException {
        log.info("Initiating GitHub OAuth login flow.");
        String state = stateManager.generateStateToken();
        stateManager.createStateCookie(request, response, state);

        // Build redirect URI dynamically — no GITHUB_REDIRECT_URI env var needed.
        String dynamicRedirectUri = buildCallbackUri(request, "/api/auth/github/callback");
        String encodedRedirectUri = java.net.URLEncoder.encode(dynamicRedirectUri, "UTF-8");

        String redirectUrl = String.format(
                "https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=user:email&state=%s",
                getCleanGithubClientId(),
                encodedRedirectUri,
                state
        );
        log.info("Redirecting browser to GitHub OAuth authorization endpoint: {}", redirectUrl);
        response.sendRedirect(redirectUrl);
    }

    /**
     * GitHub Callback endpoint. Exposes state checks, code exchange, profile query, and UI redirection.
     */
    @GetMapping("/github/callback")
    public void githubCallback(
            @RequestParam(required = false) String code,
            @RequestParam(required = false) String state,
            HttpServletRequest request,
            HttpServletResponse response) throws IOException {
        log.info("Received GitHub OAuth callback code parameter presence: {}, state: {}", code != null, state);
        try {
            // 1. Timing-safe CSRF state validation
            boolean isStateValid = stateManager.verifyState(request, state);
            if (!isStateValid) {
                log.error("GitHub state validation failed for state: {}", state);
                throw new SecurityException("GitHub state validation failed: State parameter mismatch or expired session.");
            }
            log.info("GitHub state token verified successfully.");
            stateManager.clearStateCookie(request, response);

            if (code == null || code.trim().isEmpty()) {
                throw new IllegalArgumentException("GitHub authorization code parameter is missing.");
            }

            // 2. Swaps code for secure access token
            log.info("Exchanging GitHub authorization code for token.");
            String accessToken = githubOAuthService.exchangeCodeForToken(code);

            // 3. Retrieve basic profile and primary verified email address
            log.info("Retrieving GitHub user profile and verified email.");
            Map<String, Object> githubProfile = githubOAuthService.getGitHubProfile(accessToken);
            String externalUserId = String.valueOf(githubProfile.get("id"));
            String name = (String) githubProfile.get("name");
            if (name == null || name.trim().isEmpty()) {
                name = (String) githubProfile.get("login");
            }
            String avatarUrl = (String) githubProfile.get("avatar_url");
            String verifiedEmail = githubOAuthService.getPrimaryVerifiedEmail(accessToken);
            log.info("GitHub profile details: id={}, name={}, email={}", externalUserId, name, verifiedEmail);

            // 4. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("github", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                log.info("Found existing GitHub linked user account: userId={}", userId);
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> verifiedEmail.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
                    log.info("Found existing user by email to link GitHub account: userId={}", user.getId());
                } else {
                    isNewSocial = true;
                    // Create new user profile
                    String username = verifiedEmail.split("@")[0].toLowerCase().trim();
                    Optional<UserSession> userWithUsername = userRepository.findByUsername(username);
                    if (userWithUsername.isPresent()) {
                        username = username + "_" + UUID.randomUUID().toString().substring(0, 4);
                    }

                    user = UserSession.builder()
                            .username(username)
                            .role("DEVELOPER")
                            .status("ONBOARDING")
                            .build();
                    user.packMetadata(
                            avatarUrl != null ? avatarUrl : "https://api.dicebear.com/7.x/bottts/svg?seed=" + username,
                            verifiedEmail,
                            null, // Null password indicates social-only profile
                            false
                    );
                    user = userRepository.save(user);
                    log.info("Created new user profile: userId={}, username={}", user.getId(), username);
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("github")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
                log.info("Successfully linked GitHub OAuth credentials to userId={}", user.getId());
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());

            // Redirect back to frontend overlay with URL-encoded query parameters.
            // Avatar URLs (e.g. GitHub profile pictures) and emails can contain '=',
            // '&', '+', and '/' characters that corrupt browser URL parsing when left
            // unencoded.  The JWT itself is already base64url-safe (no encoding needed).
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            String redirectDest = cleanFrontend
                    + "?token=" + jwt
                    + "&username=" + java.net.URLEncoder.encode(user.getUsername() != null ? user.getUsername() : "", "UTF-8")
                    + "&role=" + java.net.URLEncoder.encode(user.getRole() != null ? user.getRole() : "DEVELOPER", "UTF-8")
                    + "&email=" + java.net.URLEncoder.encode(user.getExtractedEmail() != null ? user.getExtractedEmail() : "", "UTF-8")
                    + "&avatar=" + java.net.URLEncoder.encode(user.getPureAvatarUrl() != null ? user.getPureAvatarUrl() : "", "UTF-8")
                    + "&new_social=" + isNewSocial;
            log.info("GitHub authentication successful. Redirecting to frontend.");
            response.sendRedirect(redirectDest);

        } catch (Exception ex) {
            log.error("GitHub OAuth callback processing error: {}", ex.getMessage(), ex);
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            response.sendRedirect(cleanFrontend + "?error=" + java.net.URLEncoder.encode(ex.getMessage(), "UTF-8"));
        }
    }
}
