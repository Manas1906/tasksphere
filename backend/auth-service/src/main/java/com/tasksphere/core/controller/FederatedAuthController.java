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
import org.springframework.web.client.RestTemplate;

import java.io.IOException;
import java.util.HashMap;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

@RestController
@RequestMapping("/api/auth")
public class FederatedAuthController {

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
     * Browser Redirect Login Endpoint for Google OAuth.
     */
    @GetMapping("/google/login")
    public void googleLogin(HttpServletRequest request, HttpServletResponse response) throws IOException {
        String state = stateManager.generateStateToken();
        stateManager.createStateCookie(request, response, state);

        String redirectUrl = String.format(
                "https://accounts.google.com/o/oauth2/v2/auth?client_id=%s&redirect_uri=%s&response_type=code&scope=openid%%20email%%20profile&state=%s",
                getCleanGoogleClientId(),
                googleRedirectUri != null ? googleRedirectUri.trim() : "",
                state
        );
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
        try {
            // 1. Timing-safe CSRF state validation
            boolean isStateValid = stateManager.verifyState(request, state);
            if (!isStateValid) {
                throw new SecurityException("Google state validation failed: State parameter mismatch or expired session.");
            }
            stateManager.clearStateCookie(request, response);

            if (code == null || code.trim().isEmpty()) {
                throw new IllegalArgumentException("Google authorization code parameter is missing.");
            }

            // 2. Exchange code for tokens at https://oauth2.googleapis.com/token
            String tokenUrl = "https://oauth2.googleapis.com/token";
            Map<String, String> requestPayload = new HashMap<>();
            requestPayload.put("client_id", getCleanGoogleClientId());
            requestPayload.put("client_secret", getCleanGoogleClientSecret());
            requestPayload.put("code", code.trim());
            requestPayload.put("grant_type", "authorization_code");
            requestPayload.put("redirect_uri", googleRedirectUri != null ? googleRedirectUri.trim() : "");

            Map<String, Object> tokenResponse = restTemplate.postForObject(tokenUrl, requestPayload, Map.class);
            
            if (tokenResponse == null || !tokenResponse.containsKey("id_token")) {
                throw new SecurityException("Google OAuth token exchange failed: No ID Token returned.");
            }

            String idToken = (String) tokenResponse.get("id_token");

            // 3. Cryptographic and claim validation of ID Token
            GoogleIdToken.Payload googleProfile = googleTokenVerifierService.verifyToken(idToken);
            String externalUserId = googleProfile.getSubject();
            String email = googleProfile.getEmail().toLowerCase().trim();
            String name = (String) googleProfile.get("name");
            String picture = (String) googleProfile.get("picture");

            // 4. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("google", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> email.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
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
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("google")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());

            // Redirect back to frontend overlay with success URL query parameters
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            String redirectDest = String.format(
                    "%s?token=%s&username=%s&role=%s&email=%s&avatar=%s&new_social=%b",
                    cleanFrontend,
                    jwt,
                    user.getUsername(),
                    user.getRole(),
                    user.getExtractedEmail(),
                    user.getPureAvatarUrl(),
                    isNewSocial
            );
            response.sendRedirect(redirectDest);

        } catch (Exception ex) {
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
                Map<String, String> err = new HashMap<>();
                err.put("error", "CSRF validation failed: Token mismatch or missing credentials.");
                return ResponseEntity.status(HttpStatus.BAD_REQUEST).body(err);
            }

            // 2. Cryptographic and claim validation
            GoogleIdToken.Payload googleProfile = googleTokenVerifierService.verifyToken(idToken);
            String externalUserId = googleProfile.getSubject();
            String email = googleProfile.getEmail().toLowerCase().trim();
            String name = (String) googleProfile.get("name");
            String picture = (String) googleProfile.get("picture");

            // 3. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("google", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> email.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
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
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("google")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());

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
        String state = stateManager.generateStateToken();
        stateManager.createStateCookie(request, response, state);

        String redirectUrl = String.format(
                "https://github.com/login/oauth/authorize?client_id=%s&redirect_uri=%s&scope=user:email&state=%s",
                getCleanGithubClientId(),
                githubRedirectUri != null ? githubRedirectUri.trim() : "",
                state
        );
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
        try {
            // 1. Timing-safe CSRF state validation
            boolean isStateValid = stateManager.verifyState(request, state);
            if (!isStateValid) {
                throw new SecurityException("GitHub state validation failed: State parameter mismatch or expired session.");
            }
            stateManager.clearStateCookie(request, response);

            if (code == null || code.trim().isEmpty()) {
                throw new IllegalArgumentException("GitHub authorization code parameter is missing.");
            }

            // 2. Swaps code for secure access token
            String accessToken = githubOAuthService.exchangeCodeForToken(code);

            // 3. Retrieve basic profile and primary verified email address
            Map<String, Object> githubProfile = githubOAuthService.getGitHubProfile(accessToken);
            String externalUserId = String.valueOf(githubProfile.get("id"));
            String name = (String) githubProfile.get("name");
            if (name == null || name.trim().isEmpty()) {
                name = (String) githubProfile.get("login");
            }
            String avatarUrl = (String) githubProfile.get("avatar_url");
            String verifiedEmail = githubOAuthService.getPrimaryVerifiedEmail(accessToken);

            // 4. Identity Reconciliation Loop
            Optional<OAuthAccount> existingOauth = oauthAccountRepository.findByProviderAndProviderUserId("github", externalUserId);
            UserSession user;
            boolean isNewSocial = false;

            if (existingOauth.isPresent()) {
                String userId = existingOauth.get().getUser().getId();
                user = userRepository.findById(userId).orElseThrow(() -> 
                    new SecurityException("Linked user session not found in database."));
            } else {
                // Find existing user by verified email (Automatic Account Linking)
                Optional<UserSession> existingUser = userRepository.findAll().stream()
                        .filter(u -> verifiedEmail.equalsIgnoreCase(u.getExtractedEmail()))
                        .findFirst();

                if (existingUser.isPresent()) {
                    user = existingUser.get();
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
                }

                // Link social credential
                OAuthAccount oauth = OAuthAccount.builder()
                        .user(user)
                        .provider("github")
                        .providerUserId(externalUserId)
                        .build();
                oauthAccountRepository.save(oauth);
            }

            // Generate JWT session token
            String jwt = tokenProvider.generateToken(user.getExtractedEmail());

            // Redirect back to frontend overlay with success URL query parameters
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            String redirectDest = String.format(
                    "%s?token=%s&username=%s&role=%s&email=%s&avatar=%s&new_social=%b",
                    cleanFrontend,
                    jwt,
                    user.getUsername(),
                    user.getRole(),
                    user.getExtractedEmail(),
                    user.getPureAvatarUrl(),
                    isNewSocial
            );
            response.sendRedirect(redirectDest);

        } catch (Exception ex) {
            String cleanFrontend = frontendUrl.endsWith("/") ? frontendUrl.substring(0, frontendUrl.length() - 1) : frontendUrl;
            response.sendRedirect(cleanFrontend + "?error=" + java.net.URLEncoder.encode(ex.getMessage(), "UTF-8"));
        }
    }
}
