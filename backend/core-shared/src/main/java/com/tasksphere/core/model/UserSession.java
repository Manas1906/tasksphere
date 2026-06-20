package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "users")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserSession {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @Column(unique = true, nullable = false)
    private String username;

    private String role; // e.g. PRODUCT_OWNER, DEVELOPER, DESIGNER, STAKEHOLDER

    @Column(name = "avatar_url", columnDefinition = "TEXT")
    private String avatarUrl;

    private String status; // ONLINE, AWAY, DND, OFFLINE

    @Column(name = "last_active_time")
    @Builder.Default
    private Instant lastActiveTime = Instant.now();

    @Column(name = "email", unique = true)
    private String email;

    @Column(name = "password_hash")
    private String passwordHash;

    @Column(name = "mfa_enabled")
    @Builder.Default
    private boolean mfaEnabled = false;

    @Column(name = "unlocked_wallpapers", length = 1024)
    @Builder.Default
    private String unlockedWallpapers = "grid";

    @Column(name = "unlocked_sounds", length = 1024)
    @Builder.Default
    private String unlockedSounds = "minimal";

    @Transient
    private String password;

    @Transient
    private Boolean mfa;

    public String getExtractedEmail() {
        if (email != null && !email.trim().isEmpty()) {
            return email.toLowerCase().trim();
        }
        if (avatarUrl == null || !avatarUrl.contains("||email:")) {
            return null;
        }
        try {
            String[] parts = avatarUrl.split("\\|\\|");
            for (String part : parts) {
                if (part.startsWith("email:")) {
                    return part.substring(6).trim();
                }
            }
        } catch (Exception e) {
            // Ignore
        }
        return null;
    }

    public String getPasswordHash() {
        if (passwordHash != null && !passwordHash.trim().isEmpty()) {
            return passwordHash;
        }
        if (avatarUrl == null || !avatarUrl.contains("||pwd:")) {
            return null;
        }
        try {
            String[] parts = avatarUrl.split("\\|\\|");
            for (String part : parts) {
                if (part.startsWith("pwd:")) {
                    return part.substring(4).trim();
                }
            }
        } catch (Exception e) {
            // Ignore
        }
        return null;
    }

    public boolean isMfaEnabled() {
        if (mfaEnabled) {
            return true;
        }
        if (avatarUrl == null || !avatarUrl.contains("||mfa:")) {
            return false;
        }
        try {
            String[] parts = avatarUrl.split("\\|\\|");
            for (String part : parts) {
                if (part.startsWith("mfa:")) {
                    return Boolean.parseBoolean(part.substring(4).trim());
                }
            }
        } catch (Exception e) {
            // Ignore
        }
        return false;
    }

    public String getPureAvatarUrl() {
        if (avatarUrl == null) {
            return null;
        }
        if (!avatarUrl.contains("||")) {
            return avatarUrl;
        }
        return avatarUrl.split("\\|\\|")[0];
    }

    public void packMetadata(String avatar, String email, String pwdHash, boolean mfa) {
        this.email = email != null ? email.toLowerCase().trim() : null;
        this.passwordHash = pwdHash;
        this.mfaEnabled = mfa;

        String baseAvatar = (avatar != null && avatar.contains("||")) ? avatar.split("\\|\\|")[0] : avatar;
        this.avatarUrl = String.format("%s||email:%s||pwd:%s||mfa:%b", 
            baseAvatar != null ? baseAvatar : "",
            email != null ? email.toLowerCase().trim() : "",
            pwdHash != null ? pwdHash : "",
            mfa
        );
    }
}
