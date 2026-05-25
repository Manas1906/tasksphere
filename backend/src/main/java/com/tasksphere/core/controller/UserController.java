package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import com.tasksphere.core.service.EmailService;
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

@RestController
@RequestMapping("/api/users")
public class UserController {

    @Autowired
    private UserSessionRepository userRepository;

    @Autowired
    private BCryptPasswordEncoder passwordEncoder;

    @Autowired
    private EmailService emailService;

    @GetMapping
    public ResponseEntity<List<UserSession>> getAllUsers() {
        return ResponseEntity.ok(userRepository.findAll());
    }

    @PostMapping("/login")
    public ResponseEntity<UserSession> login(@RequestBody UserSession user) {
        Optional<UserSession> existingUser = userRepository.findByUsername(user.getUsername());
        if (existingUser.isPresent()) {
            UserSession activeUser = existingUser.get();
            
            // If the user's status is already PENDING_APPROVAL, keep it restricted.
            // Otherwise, set them to ONLINE.
            if (!"PENDING_APPROVAL".equalsIgnoreCase(activeUser.getStatus())) {
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
            }
            
            return ResponseEntity.ok(userRepository.save(activeUser));
        } else {
            // New user registration
            String initialStatus = "ONLINE";
            String role = user.getRole();
            
            // Check if user has admin privileges. If not, mark status as PENDING_APPROVAL
            if (!"PRODUCT_OWNER".equalsIgnoreCase(role) && !"MANAGER".equalsIgnoreCase(role)) {
                initialStatus = "PENDING_APPROVAL";
            }
            
            // Encrypt and serialize profile credentials if password and email are supplied
            String pwdHash = user.getPassword() != null ? passwordEncoder.encode(user.getPassword()) : null;
            boolean mfaVal = user.getMfa() != null ? user.getMfa() : false;
            
            UserSession newUser = UserSession.builder()
                    .username(user.getUsername())
                    .role(role != null ? role : "DEVELOPER")
                    .status(initialStatus)
                    .build();
            
            newUser.packMetadata(user.getAvatarUrl(), user.getEmail(), pwdHash, mfaVal);
            
            return ResponseEntity.ok(userRepository.save(newUser));
        }
    }

    @PatchMapping("/{id}/status")
    public ResponseEntity<UserSession> updateStatus(@PathVariable String id, @RequestBody String status) {
        String cleanedStatus = status.replace("\"", "").trim();
        return userRepository.findById(id)
                .map(user -> {
                    user.setStatus(cleanedStatus);
                    user.setLastActiveTime(Instant.now());
                    return ResponseEntity.ok(userRepository.save(user));
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

        // Dispatch beautiful welcome onboarding newsletter asynchronously
        String userEmail = user.getExtractedEmail();
        if (userEmail != null && !userEmail.trim().isEmpty()) {
            try {
                emailService.sendWelcomeEmail(userEmail, user.getUsername(), user.getRole());
            } catch (Exception ex) {
                System.err.println("[EMAIL-ERROR] Failed to dispatch welcome email: " + ex.getMessage());
            }
        }

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
