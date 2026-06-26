package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.EmailService;
import com.tasksphere.core.service.RedisCacheService;
import com.tasksphere.core.service.UserApprovalService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import com.tasksphere.core.service.EventPublisher;
import com.tasksphere.core.event.UserCreatedEvent;
import com.tasksphere.core.event.UserPresenceEvent;

@RestController
@RequestMapping("/api/users")
public class UserController {

    private static final Logger log = LoggerFactory.getLogger(UserController.class);

    @Autowired
    private UserSessionRepository userRepository;

    @Autowired
    private BCryptPasswordEncoder passwordEncoder;

    @Autowired
    private EmailService emailService;

    @Autowired
    private RedisCacheService redisCacheService;

    @Autowired
    private UserApprovalService userApprovalService;

    @Autowired
    private EventPublisher eventPublisher;

    @GetMapping
    public ResponseEntity<List<UserSession>> getAllUsers() {
        List<UserSession> users = userRepository.findAll();
        for (UserSession user : users) {
            if ("PENDING_APPROVAL".equalsIgnoreCase(user.getStatus())) {
                continue;
            }
            if (redisCacheService.isUserOnline(user.getUsername())) {
                user.setStatus("ONLINE");
            } else {
                user.setStatus("OFFLINE");
            }
        }
        return ResponseEntity.ok(users);
    }

    /**
     * Lightweight session-validation endpoint used by the frontend on every page load.
     * Returns the REAL database status for the authenticated user (ONBOARDING,
     * PENDING_APPROVAL, ONLINE, etc.) — unlike getAllUsers() which overwrites every
     * non-pending user's status with ONLINE/OFFLINE from Redis, hiding the ONBOARDING
     * state and making it impossible for the frontend to detect incomplete social signups.
     *
     * The endpoint is protected by the JWT filter (anyRequest().authenticated()),
     * so an expired/missing token automatically returns 401 — which is exactly what
     * the frontend uses as the logout signal during its startup session check.
     */
    @GetMapping("/me")
    public ResponseEntity<?> getCurrentUser() {
        org.springframework.security.core.Authentication auth =
            org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();

        if (auth == null || !auth.isAuthenticated() || "anonymousUser".equals(auth.getPrincipal())) {
            log.warn("[USERS-ME] No authenticated principal found in SecurityContext — returning 401.");
            return ResponseEntity.status(401).body(java.util.Collections.singletonMap("error", "Not authenticated"));
        }

        String email = auth.getName(); // JWT subject is the email
        log.info("[USERS-ME] Session check for principal email: {}", email);

        // Look up by exact email match (case-insensitive)
        java.util.Optional<UserSession> found = userRepository.findAll().stream()
            .filter(u -> {
                String dbEmail = u.getExtractedEmail();
                return dbEmail != null && dbEmail.equalsIgnoreCase(email.trim());
            })
            .findFirst();

        if (!found.isPresent()) {
            // May happen after an H2 reset — return 404 (NOT 401 so the frontend
            // falls back to getUsers() rather than clearing the session).
            log.warn("[USERS-ME] User not found for email: {} — returning 404.", email);
            return ResponseEntity.status(404).body(java.util.Collections.singletonMap("error", "User not found in database"));
        }

        UserSession user = found.get();
        log.info("[USERS-ME] Found user: {} | status: {} | role: {}", user.getUsername(), user.getStatus(), user.getRole());
        return ResponseEntity.ok(user);
    }

    @PostMapping("/login")
    public ResponseEntity<?> login(@RequestBody UserSession user) {
        // Resolve missing email from authenticated Spring Security Context if not provided
        String resolvedEmail = user.getEmail();
        if (resolvedEmail == null || resolvedEmail.trim().isEmpty()) {
            org.springframework.security.core.Authentication auth = org.springframework.security.core.context.SecurityContextHolder.getContext().getAuthentication();
            if (auth != null && auth.getName() != null && !auth.getName().trim().isEmpty()) {
                String principalName = auth.getName().trim();
                if (principalName.contains("@")) {
                    resolvedEmail = principalName;
                }
            }
        }
        if (resolvedEmail != null) {
            resolvedEmail = resolvedEmail.toLowerCase().trim();
            user.setEmail(resolvedEmail);
        }

        Optional<UserSession> existingUser = userRepository.findByUsername(user.getUsername());
        if (!existingUser.isPresent() && resolvedEmail != null && !resolvedEmail.trim().isEmpty()) {
            Optional<UserSession> userByEmail = userRepository.findByEmail(resolvedEmail);
            if (userByEmail.isPresent()) {
                UserSession sessionToRename = userByEmail.get();
                sessionToRename.setUsername(user.getUsername());
                existingUser = Optional.of(sessionToRename);
            }
        }
        if (existingUser.isPresent()) {
            UserSession activeUser = existingUser.get();
            String existingEmail = activeUser.getExtractedEmail();
            String newEmail = user.getEmail();

            // Self-heal missing email in database if we now have a resolved email
            if ((existingEmail == null || existingEmail.trim().isEmpty()) && resolvedEmail != null && !resolvedEmail.trim().isEmpty()) {
                existingEmail = resolvedEmail;
                activeUser.packMetadata(activeUser.getPureAvatarUrl(), existingEmail, activeUser.getPasswordHash(), activeUser.isMfaEnabled());
            }

            // Prevent username hijacking or overwriting by a different email address
            if (existingEmail != null && newEmail != null && !existingEmail.equalsIgnoreCase(newEmail.trim())) {
                Map<String, String> err = new HashMap<>();
                err.put("error", "The username '" + user.getUsername() + "' is already registered by a different email address. Please choose a unique username.");
                return ResponseEntity.status(409).body(err);
            }

            // Allow Admin Direct Bypass: Update status to ONLINE if the user is assigned a PRODUCT_OWNER or MANAGER role during profile update.
            boolean isNewProfileCompletion = "ONBOARDING".equalsIgnoreCase(activeUser.getStatus());
            String targetRole = user.getRole() != null ? user.getRole() : activeUser.getRole();
            if ("PRODUCT_OWNER".equalsIgnoreCase(targetRole) || "MANAGER".equalsIgnoreCase(targetRole)) {
                activeUser.setStatus("ONLINE");
            } else if (isNewProfileCompletion) {
                // Temporary: auto-approve for recruiters to explore
                activeUser.setStatus("ONLINE");
            } else if (!"PENDING_APPROVAL".equalsIgnoreCase(activeUser.getStatus())) {
                activeUser.setStatus("ONLINE");
            }

            activeUser.setLastActiveTime(Instant.now());
            if (user.getRole() != null) activeUser.setRole(user.getRole());
            
            // If we are updating avatarUrl or registering password/mfa settings
            if (user.getAvatarUrl() != null) {
                String emailVal = user.getEmail() != null ? user.getEmail() : activeUser.getExtractedEmail();
                String pwdHash = user.getPassword() != null ? passwordEncoder.encode(user.getPassword()) : activeUser.getPasswordHash();
                boolean mfaVal = user.getMfa() != null ? user.getMfa() : activeUser.isMfaEnabled();
                activeUser.packMetadata(user.getPureAvatarUrl() != null ? user.getPureAvatarUrl() : user.getAvatarUrl(), emailVal, pwdHash, mfaVal);
            } else if (user.getEmail() != null) {
                activeUser.packMetadata(activeUser.getPureAvatarUrl(), user.getEmail(), activeUser.getPasswordHash(), activeUser.isMfaEnabled());
            }
            
            UserSession savedUser = userRepository.save(activeUser);
            
            // Publish presence update on successful login
            if ("ONLINE".equalsIgnoreCase(savedUser.getStatus())) {
                eventPublisher.publishUserPresence(UserPresenceEvent.builder()
                        .username(savedUser.getUsername())
                        .status("ONLINE")
                        .timestamp(Instant.now())
                        .build());
            }

            if (isNewProfileCompletion && "PENDING_APPROVAL".equalsIgnoreCase(savedUser.getStatus())) {
                userApprovalService.notifyAdminsForApproval(savedUser);
            } else if (isNewProfileCompletion && "ONLINE".equalsIgnoreCase(savedUser.getStatus())) {
                // Publish UserCreatedEvent for complete profile sync
                eventPublisher.publishUserCreated(UserCreatedEvent.builder()
                        .id(savedUser.getId())
                        .username(savedUser.getUsername())
                        .role(savedUser.getRole())
                        .email(savedUser.getExtractedEmail())
                        .avatarUrl(savedUser.getPureAvatarUrl())
                        .timestamp(Instant.now())
                        .build());

                // Dispatch beautiful welcome onboarding email asynchronously for auto-approved user
                String userEmail = savedUser.getExtractedEmail();
                if (userEmail != null && !userEmail.trim().isEmpty()) {
                    try {
                        emailService.sendWelcomeEmail(userEmail, savedUser.getUsername(), savedUser.getRole());
                    } catch (Exception ex) {
                        log.error("[EMAIL-ERROR] Failed to dispatch welcome email for {}: {}", savedUser.getUsername(), ex.getMessage(), ex);
                    }
                }
            }
            return ResponseEntity.ok(savedUser);
        } else {
            // New user registration
            String initialStatus = "ONLINE";
            String role = user.getRole();
            
            // Check if user has admin privileges. If not, mark status as PENDING_APPROVAL
            if (!"PRODUCT_OWNER".equalsIgnoreCase(role) && !"MANAGER".equalsIgnoreCase(role)) {
                // Temporary: auto-approve for recruiters to explore
                initialStatus = "ONLINE";
            }
            
            log.info("[USERS-REGISTER] Creating new user: username={}, role={}, status={}", user.getUsername(), role, initialStatus);

            // Encrypt and serialize profile credentials if password and email are supplied
            String pwdHash = user.getPassword() != null ? passwordEncoder.encode(user.getPassword()) : null;
            boolean mfaVal = user.getMfa() != null ? user.getMfa() : false;
            
            UserSession newUser = UserSession.builder()
                    .username(user.getUsername())
                    .role(role != null ? role : "DEVELOPER")
                    .status(initialStatus)
                    .build();
            
            newUser.packMetadata(user.getAvatarUrl(), user.getEmail(), pwdHash, mfaVal);
            
            UserSession savedUser = userRepository.save(newUser);
            log.info("[USERS-REGISTER] Saved new user with id={}, username={}", savedUser.getId(), savedUser.getUsername());

            if ("PENDING_APPROVAL".equalsIgnoreCase(initialStatus)) {
                log.info("[USERS-REGISTER] User {} requires admin approval.", savedUser.getUsername());
                userApprovalService.notifyAdminsForApproval(savedUser);
            } else if ("ONLINE".equalsIgnoreCase(initialStatus)) {
                // Publish events
                eventPublisher.publishUserCreated(UserCreatedEvent.builder()
                        .id(savedUser.getId())
                        .username(savedUser.getUsername())
                        .role(savedUser.getRole())
                        .email(savedUser.getExtractedEmail())
                        .avatarUrl(savedUser.getPureAvatarUrl())
                        .timestamp(Instant.now())
                        .build());
                eventPublisher.publishUserPresence(UserPresenceEvent.builder()
                        .username(savedUser.getUsername())
                        .status("ONLINE")
                        .timestamp(Instant.now())
                        .build());

                // Dispatch beautiful welcome onboarding email asynchronously for auto-approved user
                String userEmail = savedUser.getExtractedEmail();
                if (userEmail != null && !userEmail.trim().isEmpty()) {
                    try {
                        emailService.sendWelcomeEmail(userEmail, savedUser.getUsername(), savedUser.getRole());
                    } catch (Exception ex) {
                        log.error("[EMAIL-ERROR] Failed to dispatch welcome email for {}: {}", savedUser.getUsername(), ex.getMessage(), ex);
                    }
                }
            }
            return ResponseEntity.ok(savedUser);
        }
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<UserSession> updateStatus(@PathVariable String id, @RequestBody String status) {
        String cleanedStatus = status.replace("\"", "").trim();
        return userRepository.findById(id)
                .map(user -> {
                    user.setStatus(cleanedStatus);
                    user.setLastActiveTime(Instant.now());
                    UserSession saved = userRepository.save(user);
                    
                    // Publish presence event
                    eventPublisher.publishUserPresence(UserPresenceEvent.builder()
                            .username(saved.getUsername())
                            .status(cleanedStatus)
                            .timestamp(Instant.now())
                            .build());
                    
                    return ResponseEntity.ok(saved);
                })
                .orElse(ResponseEntity.notFound().build());
    }

    /**
     * Admin Endpoint: Approve a pending user session.
     */
    @PostMapping("/{username}/approve")
    public ResponseEntity<?> approveUser(@PathVariable String username, @RequestParam String requester) {
        if (!isAdmin(requester)) {
            return ResponseEntity.status(403).body(Collections.singletonMap("error", 
                "Access denied. Only administrators (Product Owners/Managers) can approve users."));
        }

        Optional<UserSession> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Collections.singletonMap("error", "User session not found."));
        }

        UserSession user = userOpt.get();
        user.setStatus("ONLINE");
        user.setLastActiveTime(Instant.now());
        UserSession saved = userRepository.save(user);

        // Publish events for newly approved user
        eventPublisher.publishUserCreated(UserCreatedEvent.builder()
                .id(saved.getId())
                .username(saved.getUsername())
                .role(saved.getRole())
                .email(saved.getExtractedEmail())
                .avatarUrl(saved.getPureAvatarUrl())
                .timestamp(Instant.now())
                .build());
        eventPublisher.publishUserPresence(UserPresenceEvent.builder()
                .username(saved.getUsername())
                .status("ONLINE")
                .timestamp(Instant.now())
                .build());

        // Dispatch beautiful welcome onboarding newsletter asynchronously
        String userEmail = user.getExtractedEmail();
        if (userEmail != null && !userEmail.trim().isEmpty()) {
            try {
                emailService.sendWelcomeEmail(userEmail, user.getUsername(), user.getRole());
            } catch (Exception ex) {
                log.error("[EMAIL-ERROR] Failed to dispatch welcome email for approved user {}: {}", user.getUsername(), ex.getMessage(), ex);
            }
        }

        log.info("[USERS-APPROVE] User {} approved and set ONLINE by requester {}.", username, requester);
        return ResponseEntity.ok(saved);
    }

    /**
     * Admin Endpoint: Decline or revoke a user session.
     */
    @PostMapping("/{username}/reject")
    public ResponseEntity<?> rejectUser(@PathVariable String username, @RequestParam String requester) {
        if (!isAdmin(requester)) {
            return ResponseEntity.status(403).body(Collections.singletonMap("error", 
                "Access denied. Only administrators (Product Owners/Managers) can reject users."));
        }

        Optional<UserSession> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Collections.singletonMap("error", "User session not found."));
        }

        UserSession user = userOpt.get();
        userRepository.delete(user);
        
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "User session rejected/removed successfully.");
        return ResponseEntity.ok(response);
    }

    /**
     * Helper to verify if the requester has administrative privileges.
     */
    private boolean isAdmin(String requesterUsername) {
        if (requesterUsername == null || requesterUsername.trim().isEmpty()) {
            return false;
        }
        return userRepository.findByUsername(requesterUsername)
                .map(user -> "PRODUCT_OWNER".equalsIgnoreCase(user.getRole()) || "MANAGER".equalsIgnoreCase(user.getRole()))
                .orElse(false);
    }

    /**
     * Update dynamic security credentials (MFA toggle & Change Password)
     */
    @PatchMapping("/profile/security")
    public ResponseEntity<?> updateSecuritySettings(@RequestBody Map<String, Object> payload) {
        String username = (String) payload.get("username");
        if (username == null || username.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Username is required."));
        }

        Optional<UserSession> userOpt = userRepository.findByUsername(username);
        if (userOpt.isEmpty()) {
            return ResponseEntity.status(404).body(Collections.singletonMap("error", "User profile not found."));
        }

        UserSession user = userOpt.get();

        String email = user.getExtractedEmail();
        String currentPureAvatar = user.getPureAvatarUrl();
        String passwordHash = user.getPasswordHash();
        boolean mfaEnabled = user.isMfaEnabled();

        // 0. Update custom avatar if supplied
        if (payload.containsKey("avatar")) {
            currentPureAvatar = (String) payload.get("avatar");
        }

        // 1. Toggle MFA if supplied
        if (payload.containsKey("mfa")) {
            mfaEnabled = (Boolean) payload.get("mfa");
        }

        // 2. Change password if supplied
        if (payload.containsKey("password") && payload.get("password") != null) {
            String newPassword = (String) payload.get("password");
            if (!newPassword.trim().isEmpty()) {
                passwordHash = passwordEncoder.encode(newPassword);
            }
        }

        // Repack metadata securely
        user.packMetadata(currentPureAvatar, email, passwordHash, mfaEnabled);
        UserSession savedUser = userRepository.save(user);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("mfa", savedUser.isMfaEnabled());
        response.put("message", "Security credentials synchronized successfully.");
        return ResponseEntity.ok(response);
    }
}
