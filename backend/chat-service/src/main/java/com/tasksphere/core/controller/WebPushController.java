package com.tasksphere.core.controller;

import com.tasksphere.core.service.WebPushService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

@RestController
@RequestMapping("/api/web-push")
public class WebPushController {

    private static final Logger log = LoggerFactory.getLogger(WebPushController.class);

    @Autowired
    private WebPushService webPushService;

    @Autowired
    private org.springframework.core.env.Environment env;

    @GetMapping("/public-key")
    public ResponseEntity<Map<String, String>> getPublicKey() {
        String key = env.getProperty("vapid.public.key");
        return ResponseEntity.ok(Collections.singletonMap("publicKey", key));
    }

    @PostMapping("/subscribe")
    public ResponseEntity<?> subscribe(
            @RequestParam String username,
            @RequestBody WebPushService.WebPushSubscription subscription) {
        
        if (username == null || username.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Username is required."));
        }

        webPushService.subscribe(username, subscription);
        
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "Push subscription successfully registered for '" + username + "'.");
        return ResponseEntity.ok(response);
    }

    @PostMapping("/unsubscribe")
    public ResponseEntity<?> unsubscribe(@RequestParam String username) {
        if (username == null || username.trim().isEmpty()) {
            return ResponseEntity.badRequest().body(Collections.singletonMap("error", "Username is required."));
        }

        webPushService.unsubscribe(username);
        
        Map<String, Object> response = new HashMap<>();
        response.put("success", true);
        response.put("message", "Push subscription successfully removed for '" + username + "'.");
        return ResponseEntity.ok(response);
    }
}
