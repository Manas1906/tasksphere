package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.time.Instant;

@Entity
@Table(name = "chat_group_members", uniqueConstraints = {
    @UniqueConstraint(columnNames = {"group_id", "username"})
})
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class ChatGroupMember {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "group_id", nullable = false)
    private Long groupId;

    @Column(nullable = false)
    private String username;

    @Column(name = "joined_at")
    @Builder.Default
    private Instant joinedAt = Instant.now();
}
