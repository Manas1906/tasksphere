package com.tasksphere.core.repository;

import com.tasksphere.core.model.WorkspaceUpgradeSession;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface WorkspaceUpgradeSessionRepository extends JpaRepository<WorkspaceUpgradeSession, String> {
    List<WorkspaceUpgradeSession> findByStatus(String status);
    Optional<WorkspaceUpgradeSession> findFirstByStatusOrderByCreatedAtDesc(String status);
}
