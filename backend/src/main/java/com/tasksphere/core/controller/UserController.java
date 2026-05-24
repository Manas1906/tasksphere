package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
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
            if (user.getAvatarUrl() != null) activeUser.setAvatarUrl(user.getAvatarUrl());
            return ResponseEntity.ok(userRepository.save(activeUser));
        } else {
            // New user registration
            String initialStatus = "ONLINE";
            String role = user.getRole();
            
            // Check if user has admin privileges. If not, mark status as PENDING_APPROVAL
            if (!"PRODUCT_OWNER".equalsIgnoreCase(role) && !"MANAGER".equalsIgnoreCase(role)) {
                initialStatus = "PENDING_APPROVAL";
            }
            
            UserSession newUser = UserSession.builder()
                    .username(user.getUsername())
                    .role(role != null ? role : "DEVELOPER")
                    .avatarUrl(user.getAvatarUrl())
                    .status(initialStatus)
                    .build();
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
}
