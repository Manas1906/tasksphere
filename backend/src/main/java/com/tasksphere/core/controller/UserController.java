package com.tasksphere.core.controller;

import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import java.time.Instant;
import java.util.List;
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
            activeUser.setStatus("ONLINE");
            activeUser.setLastActiveTime(Instant.now());
            if (user.getRole() != null) activeUser.setRole(user.getRole());
            if (user.getAvatarUrl() != null) activeUser.setAvatarUrl(user.getAvatarUrl());
            return ResponseEntity.ok(userRepository.save(activeUser));
        } else {
            UserSession newUser = UserSession.builder()
                    .username(user.getUsername())
                    .role(user.getRole() != null ? user.getRole() : "DEVELOPER")
                    .avatarUrl(user.getAvatarUrl())
                    .status("ONLINE")
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
}
