package com.tasksphere.core.model;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * RedisEvents - Event schemas for transactional email & chat bot queue dispatches.
 * Serialized to/from JSON strings inside Redis Lists.
 */
public class RedisEvents {

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class EmailEvent {
        private String type; // e.g., "OTP", "WELCOME"
        private String toEmail;
        private String subject;
        private String htmlContent;
    }

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class AiBotEvent {
        private String username;
        private String avatarUrl;
        private String message;
        private boolean isDm;
    }
}
