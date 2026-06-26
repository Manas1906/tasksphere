package com.tasksphere.core.service;

import com.tasksphere.core.model.ChatGroup;
import com.tasksphere.core.model.ChatGroupMember;
import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.repository.ChatGroupRepository;
import com.tasksphere.core.repository.ChatGroupMemberRepository;
import com.tasksphere.core.repository.ChatMessageRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.messaging.simp.SimpMessagingTemplate;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import com.tasksphere.core.model.UserSession;
import com.tasksphere.core.repository.UserSessionRepository;

import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

@Service
@Transactional
public class GroupChatService {

    private static final Logger log = LoggerFactory.getLogger(GroupChatService.class);

    @Autowired
    private ChatGroupRepository chatGroupRepository;

    @Autowired
    private ChatGroupMemberRepository chatGroupMemberRepository;

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    @Autowired
    private SimpMessagingTemplate messagingTemplate;

    @Autowired
    private UserSessionRepository userSessionRepository;

    @Autowired
    private EmailService emailService;

    public ChatGroup createGroup(String name, String iconUrl, List<String> memberUsernames, String creatorUsername) {
        ChatGroup group = ChatGroup.builder()
                .name(name)
                .iconUrl(iconUrl)
                .createdBy(creatorUsername)
                .createdAt(Instant.now())
                .build();
        
        ChatGroup savedGroup = chatGroupRepository.save(group);

        List<String> uniqueMembers = new ArrayList<>();
        if (memberUsernames != null) {
            for (String username : memberUsernames) {
                if (username != null && !username.trim().isEmpty() && !uniqueMembers.contains(username.trim())) {
                    uniqueMembers.add(username.trim());
                }
            }
        }

        if (!uniqueMembers.contains(creatorUsername)) {
            uniqueMembers.add(creatorUsername);
        }

        for (String username : uniqueMembers) {
            ChatGroupMember member = ChatGroupMember.builder()
                    .groupId(savedGroup.getId())
                    .username(username)
                    .joinedAt(Instant.now())
                    .build();
            chatGroupMemberRepository.save(member);
        }

        // Post system message
        ChatMessage sysMsg = ChatMessage.builder()
                .username("System")
                .message("[System] Group created by " + creatorUsername)
                .groupId(savedGroup.getId())
                .timestamp(Instant.now())
                .build();
        chatMessageRepository.save(sysMsg);

        // Send email notifications to all members except the creator
        for (String username : uniqueMembers) {
            if (!username.equals(creatorUsername)) {
                sendAddEmailQuietly(username, savedGroup.getName(), creatorUsername);
            }
        }

        return savedGroup;
    }

    public List<ChatGroup> getUserGroups(String username) {
        return chatGroupRepository.findGroupsByMember(username);
    }

    public ChatGroup updateGroup(Long groupId, String name, String iconUrl, List<String> newMembers, String requesterUsername) {
        if (!isMember(groupId, requesterUsername)) {
            throw new RuntimeException("Unauthorized: User is not a member of this group");
        }

        ChatGroup group = chatGroupRepository.findById(groupId)
                .orElseThrow(() -> new RuntimeException("Group not found with ID: " + groupId));

        boolean updated = false;
        if (name != null && !name.trim().isEmpty() && !name.equals(group.getName())) {
            group.setName(name);
            updated = true;
        }
        if (iconUrl != null && !iconUrl.equals(group.getIconUrl())) {
            group.setIconUrl(iconUrl);
            updated = true;
        }

        if (updated) {
            chatGroupRepository.save(group);
            // Broadcast group update notification system message
            ChatMessage sysMsg = ChatMessage.builder()
                    .username("System")
                    .message("[System] Group settings updated by " + requesterUsername)
                    .groupId(groupId)
                    .timestamp(Instant.now())
                    .build();
            chatMessageRepository.save(sysMsg);
            messagingTemplate.convertAndSend("/topic/group." + groupId, sysMsg);
        }

        // Add new members
        if (newMembers != null) {
            for (String username : newMembers) {
                if (username != null && !username.trim().isEmpty()) {
                    String trimmed = username.trim();
                    if (!isMember(groupId, trimmed)) {
                        ChatGroupMember member = ChatGroupMember.builder()
                                .groupId(groupId)
                                .username(trimmed)
                                .joinedAt(Instant.now())
                                .build();
                        chatGroupMemberRepository.save(member);

                        ChatMessage joinMsg = ChatMessage.builder()
                                .username("System")
                                .message("[System] " + trimmed + " was added to the group")
                                .groupId(groupId)
                                .timestamp(Instant.now())
                                .build();
                        chatMessageRepository.save(joinMsg);
                        messagingTemplate.convertAndSend("/topic/group." + groupId, joinMsg);

                        // Send email notification to the newly added member
                        sendAddEmailQuietly(trimmed, group.getName(), requesterUsername);
                    }
                }
            }
        }

        return group;
    }

    public void leaveGroup(Long groupId, String username) {
        if (!isMember(groupId, username)) {
            throw new RuntimeException("User is not a member of this group");
        }

        chatGroupMemberRepository.deleteByGroupIdAndUsername(groupId, username);

        // Send a system message that the user left
        ChatMessage exitMsg = ChatMessage.builder()
                .username("System")
                .message("[System] " + username + " has left the group")
                .groupId(groupId)
                .timestamp(Instant.now())
                .build();
        chatMessageRepository.save(exitMsg);
        messagingTemplate.convertAndSend("/topic/group." + groupId, exitMsg);

        // Check if there are any members left in the group
        List<ChatGroupMember> remaining = chatGroupMemberRepository.findByGroupId(groupId);
        if (remaining.isEmpty()) {
            // Delete group and messages
            chatMessageRepository.deleteByGroupId(groupId);
            chatGroupRepository.deleteById(groupId);
            System.out.println("[GROUP-CHAT] Deleted empty group ID: " + groupId);
        }
    }

    public List<ChatMessage> getGroupMessages(Long groupId, String username) {
        if (!isMember(groupId, username)) {
            throw new RuntimeException("Unauthorized: User is not a member of this group");
        }
        return chatMessageRepository.findByGroupIdOrderByTimestampAsc(groupId);
    }

    public boolean isMember(Long groupId, String username) {
        return chatGroupMemberRepository.existsByGroupIdAndUsername(groupId, username);
    }

    public List<String> getGroupMemberNames(Long groupId) {
        List<ChatGroupMember> members = chatGroupMemberRepository.findByGroupId(groupId);
        List<String> names = new ArrayList<>();
        for (ChatGroupMember m : members) {
            names.add(m.getUsername());
        }
        return names;
    }

    public String getGroupName(Long groupId) {
        return chatGroupRepository.findById(groupId)
                .map(ChatGroup::getName)
                .orElse("Group");
    }

    private void sendAddEmailQuietly(String username, String groupName, String addedBy) {
        try {
            Optional<UserSession> userOpt = userSessionRepository.findByUsername(username);
            if (userOpt.isPresent()) {
                UserSession user = userOpt.get();
                String email = user.getExtractedEmail();
                if (email != null && !email.trim().isEmpty()) {
                    emailService.sendGroupAddedEmail(email, groupName, addedBy);
                } else {
                    System.out.println("[GROUP-CHAT-EMAIL] User " + username + " has no email configured.");
                }
            } else {
                System.out.println("[GROUP-CHAT-EMAIL] User " + username + " not found to send group added email.");
            }
        } catch (Exception e) {
            System.err.println("[GROUP-CHAT-EMAIL] Failed to send group addition email to " + username + ": " + e.getMessage());
        }
    }
}
