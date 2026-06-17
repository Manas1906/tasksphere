package com.tasksphere.core.repository;

import com.tasksphere.core.model.ChatGroup;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;
import org.springframework.stereotype.Repository;
import java.util.List;

@Repository
public interface ChatGroupRepository extends JpaRepository<ChatGroup, Long> {

    @Query("SELECT g FROM ChatGroup g WHERE g.id IN (SELECT m.groupId FROM ChatGroupMember m WHERE m.username = :username)")
    List<ChatGroup> findGroupsByMember(@Param("username") String username);
}
