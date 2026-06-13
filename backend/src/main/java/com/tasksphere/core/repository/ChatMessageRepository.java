package com.tasksphere.core.repository;

import com.tasksphere.core.model.ChatMessage;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Modifying;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ChatMessageRepository extends JpaRepository<ChatMessage, Long> {
    // Get recent 50 messages ordered by time so new users see room context
    List<ChatMessage> findTop50ByOrderByTimestampAsc();

    @Modifying
    @Query("DELETE FROM ChatMessage m WHERE " +
            "(m.username = :user1 AND m.message LIKE CONCAT('[DM:', :user2, ']%')) OR " +
            "(m.username = :user2 AND m.message LIKE CONCAT('[DM:', :user1, ']%'))")
    void deleteDirectMessagesBetween(@Param("user1") String user1, @Param("user2") String user2);
}
