package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "user_pledges")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class UserPledge {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @Column(name = "session_id", nullable = false)
    private String sessionId;

    @Column(name = "username", nullable = false)
    private String username;

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "payment_id")
    private String paymentId;

    @Column(name = "pre_auth_amount", nullable = false)
    private BigDecimal preAuthAmount;

    @Column(name = "final_captured_amount")
    private BigDecimal finalCapturedAmount;

    @Column(name = "payment_method", nullable = false)
    private String paymentMethod;

    @Column(name = "status", nullable = false)
    private String status; // PENDING, AUTHORIZED, CAPTURED, VOIDED, FAILED

    @Column(name = "created_at", nullable = false)
    @Builder.Default
    private Instant createdAt = Instant.now();
}
