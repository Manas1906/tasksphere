package com.tasksphere.core.repository;

import com.tasksphere.core.model.UserPledge;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;
import java.util.Optional;

@Repository
public interface UserPledgeRepository extends JpaRepository<UserPledge, String> {
    List<UserPledge> findBySessionId(String sessionId);
    List<UserPledge> findByUsername(String username);
    Optional<UserPledge> findBySessionIdAndUsername(String sessionId, String username);
    Optional<UserPledge> findByOrderId(String orderId);
}
