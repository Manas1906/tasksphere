package com.tasksphere.core.controller;

import com.tasksphere.core.model.FeatureToggle;
import com.tasksphere.core.repository.FeatureToggleRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.web.bind.annotation.*;

import java.time.Instant;
import java.util.*;

@RestController
@RequestMapping("/api/features")
public class FeatureToggleController {

    @Autowired
    private FeatureToggleRepository featureToggleRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    /**
     * Returns all feature toggles as a key-value map.
     * Public endpoint — no admin check required for reading.
     */
    @GetMapping
    public ResponseEntity<Map<String, Boolean>> getAllToggles() {
        List<FeatureToggle> toggles = featureToggleRepository.findAll();

        // Seed default toggles if table is empty (first-run bootstrap)
        if (toggles.isEmpty()) {
            FeatureToggle voiceCalling = FeatureToggle.builder()
                    .featureKey("voice_calling")
                    .enabled(false)
                    .updatedBy("system")
                    .updatedAt(Instant.now())
                    .build();
            featureToggleRepository.save(voiceCalling);
            toggles = featureToggleRepository.findAll();
        }

        Map<String, Boolean> result = new LinkedHashMap<>();
        for (FeatureToggle t : toggles) {
            result.put(t.getFeatureKey(), t.isEnabled());
        }
        return ResponseEntity.ok(result);
    }

    /**
     * Admin-only endpoint to toggle a feature on or off.
     * Broadcasts the change over WebSocket so all connected clients update instantly.
     */
    @PutMapping("/{key}")
    public ResponseEntity<?> updateToggle(
            @PathVariable String key,
            @RequestBody Map<String, Object> payload,
            @RequestParam String requester) {

        // Verify admin privileges
        if (!isAdmin(requester)) {
            return ResponseEntity.status(403).body(
                    Collections.singletonMap("error", "Access denied. Only administrators can manage feature toggles."));
        }

        Boolean enabled = (Boolean) payload.get("enabled");
        if (enabled == null) {
            return ResponseEntity.badRequest().body(
                    Collections.singletonMap("error", "Missing 'enabled' field in request body."));
        }

        Optional<FeatureToggle> toggleOpt = featureToggleRepository.findByFeatureKey(key);
        FeatureToggle toggle;
        if (toggleOpt.isPresent()) {
            toggle = toggleOpt.get();
            toggle.setEnabled(enabled);
            toggle.setUpdatedBy(requester);
            toggle.setUpdatedAt(Instant.now());
        } else {
            toggle = FeatureToggle.builder()
                    .featureKey(key)
                    .enabled(enabled)
                    .updatedBy(requester)
                    .updatedAt(Instant.now())
                    .build();
        }

        featureToggleRepository.save(toggle);

        // Broadcast real-time toggle update to all connected clients
        Map<String, Object> broadcast = new HashMap<>();
        broadcast.put("featureKey", key);
        broadcast.put("enabled", enabled);
        broadcast.put("updatedBy", requester);
        broadcast.put("timestamp", Instant.now().toString());
        messagingTemplate.convertAndSend("/topic/features", broadcast);

        System.out.println("[FEATURE-TOGGLE] " + requester + " set '" + key + "' to " + enabled);

        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("featureKey", key);
        response.put("enabled", enabled);
        return ResponseEntity.ok(response);
    }

    private boolean isAdmin(String requesterUsername) {
        if (requesterUsername == null || requesterUsername.trim().isEmpty()) {
            return false;
        }
        return userSessionRepository.findByUsername(requesterUsername)
                .map(user -> "PRODUCT_OWNER".equalsIgnoreCase(user.getRole()) || "MANAGER".equalsIgnoreCase(user.getRole()))
                .orElse(false);
    }
}
