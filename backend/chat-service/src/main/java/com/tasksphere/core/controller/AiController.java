package com.tasksphere.core.controller;

import com.tasksphere.core.service.AiBotService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.util.Map;
import java.util.HashMap;

@RestController
@RequestMapping("/api/ai")
public class AiController {

    private static final Logger log = LoggerFactory.getLogger(AiController.class);

    @Autowired
    private AiBotService aiBotService;

    /**
     * Expose a secure proxy endpoint for the floating Scrum AI Co-Pilot chatbot.
     * Takes JSON payload: { "message": "user prompt here" }
     */
    @PostMapping("/chat")
    public ResponseEntity<Map<String, String>> chatWithCoPilot(@RequestBody Map<String, String> payload) {
        String message = payload.get("message");
        Map<String, String> response = new HashMap<>();

        if (message == null || message.trim().isEmpty()) {
            response.put("error", "Message cannot be empty.");
            return ResponseEntity.badRequest().body(response);
        }

        try {
            String aiReply = aiBotService.getChatbotReply(message);
            response.put("reply", aiReply);
            return ResponseEntity.ok(response);
        } catch (IllegalArgumentException e) {
            log.error("[AI-CONTROLLER-CONFIG] AI Configuration / credentials error: {}", e.getMessage());
            response.put("error", e.getMessage());
            return ResponseEntity.status(HttpStatus.SERVICE_UNAVAILABLE).body(response);
        } catch (Exception e) {
            log.error("[AI-CONTROLLER-ERROR] Failed to query Gemini chatbot: {}", e.getMessage(), e);
            response.put("error", e.getMessage());
            return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR).body(response);
        }
    }
}
