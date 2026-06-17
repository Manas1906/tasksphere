package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity
@Table(name = "chat_groups")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatGroup {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false)
    private String name;

    @Column(name = "icon_url", columnDefinition = "TEXT")
    private String iconUrl;

    @Column(name = "created_by", nullable = false)
    private String createdBy;

    @Column(name = "created_at")
    @Builder.Default
    private Instant createdAt = Instant.now();
}
