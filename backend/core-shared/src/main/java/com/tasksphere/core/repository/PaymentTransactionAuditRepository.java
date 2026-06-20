package com.tasksphere.core.repository;

import com.tasksphere.core.model.PaymentTransactionAudit;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.Optional;

@Repository
public interface PaymentTransactionAuditRepository extends JpaRepository<PaymentTransactionAudit, String> {
    Optional<PaymentTransactionAudit> findByOrderId(String orderId);
    Optional<PaymentTransactionAudit> findByPaymentId(String paymentId);
}
