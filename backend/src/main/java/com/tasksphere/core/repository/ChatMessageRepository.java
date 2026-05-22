package com.tasksphere.core.repository;

import com.tasksphere.core.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {
    // Get recent 50 messages ordered by time so new users see room context
    List<ChatMessage> findTop50ByOrderByTimestampAsc();
}
