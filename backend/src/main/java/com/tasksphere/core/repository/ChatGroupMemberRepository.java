package com.tasksphere.core.repository;

import com.tasksphere.core.model.ChatGroupMember;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.stereotype.Repository;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;
import java.util.Optional;

@Repository
public interface ChatGroupMemberRepository extends JpaRepository<ChatGroupMember, Long> {
    List<ChatGroupMember> findByGroupId(Long groupId);
    Optional<ChatGroupMember> findByGroupIdAndUsername(Long groupId, String username);
    
    @Transactional
    void deleteByGroupIdAndUsername(Long groupId, String username);
    
    boolean existsByGroupIdAndUsername(Long groupId, String username);
    
    @Transactional
    void deleteByGroupId(Long groupId);
}
