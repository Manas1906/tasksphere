package com.tasksphere.core.model;

import jakarta.persistence.*;
import lombok.*;
import java.math.BigDecimal;
import java.time.Instant;
import java.util.UUID;

@Entity
@Table(name = "payment_transaction_audits")
@Data
@NoArgsConstructor
@AllArgsConstructor
@Builder
public class PaymentTransactionAudit {

    @Id
    @Builder.Default
    private String id = UUID.randomUUID().toString();

    @Column(name = "order_id", nullable = false)
    private String orderId;

    @Column(name = "payment_id")
    private String paymentId;

    @Column(name = "payment_method")
    private String paymentMethod;

    @Column(name = "amount", nullable = false)
    private BigDecimal amount;

    @Column(name = "status", nullable = false)
    private String status;

    @Column(name = "gateway_ref")
    private String gatewayRef;

    @Column(name = "signature")
    private String signature;

    @Column(name = "timestamp", nullable = false)
    @Builder.Default
    private Instant timestamp = Instant.now();
}
