package com.tasksphere.core.controller;

import com.tasksphere.core.model.ChatGroup;
import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.service.GroupChatService;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.security.Principal;
import java.util.List;

@RestController
@RequestMapping("/api/groups")
public class GroupChatController {

    @Autowired
    private GroupChatService groupChatService;

    @Autowired
    private UserSessionRepository userSessionRepository;

    private String resolveUsername(Principal principal) {
        if (principal == null) return "CTO Guest";
        String email = principal.getName();
        return userSessionRepository.findByEmail(email)
                .map(u -> u.getUsername())
                .orElse(email);
    }

    @PostMapping
    public ResponseEntity<ChatGroup> createGroup(
            @RequestBody GroupCreateRequest request,
            Principal principal) {
        String username = resolveUsername(principal);
        ChatGroup created = groupChatService.createGroup(
                request.getName(),
                request.getIconUrl(),
                request.getMembers(),
                username
        );
        return ResponseEntity.ok(created);
    }

    @GetMapping
    public ResponseEntity<List<ChatGroup>> getUserGroups(Principal principal) {
        String username = resolveUsername(principal);
        List<ChatGroup> groups = groupChatService.getUserGroups(username);
        return ResponseEntity.ok(groups);
    }

    @PutMapping("/{id}")
    public ResponseEntity<ChatGroup> updateGroup(
            @PathVariable("id") Long groupId,
            @RequestBody GroupUpdateRequest request,
            Principal principal) {
        String username = resolveUsername(principal);
        ChatGroup updated = groupChatService.updateGroup(
                groupId,
                request.getName(),
                request.getIconUrl(),
                request.getNewMembers(),
                username
        );
        return ResponseEntity.ok(updated);
    }

    @PostMapping("/{id}/leave")
    public ResponseEntity<Void> leaveGroup(
            @PathVariable("id") Long groupId,
            Principal principal) {
        String username = resolveUsername(principal);
        groupChatService.leaveGroup(groupId, username);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/{id}/messages")
    public ResponseEntity<List<ChatMessage>> getGroupMessages(
            @PathVariable("id") Long groupId,
            Principal principal) {
        String username = resolveUsername(principal);
        List<ChatMessage> messages = groupChatService.getGroupMessages(groupId, username);
        return ResponseEntity.ok(messages);
    }

    @GetMapping("/{id}/members")
    public ResponseEntity<List<String>> getGroupMembers(
            @PathVariable("id") Long groupId,
            Principal principal) {
        String username = resolveUsername(principal);
        if (!groupChatService.isMember(groupId, username)) {
            return ResponseEntity.status(403).build();
        }
        List<String> members = groupChatService.getGroupMemberNames(groupId);
        return ResponseEntity.ok(members);
    }

    // Inner classes for Request Payload binding
    public static class GroupCreateRequest {
        private String name;
        private String iconUrl;
        private List<String> members;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getIconUrl() { return iconUrl; }
        public void setIconUrl(String iconUrl) { this.iconUrl = iconUrl; }
        public List<String> getMembers() { return members; }
        public void setMembers(List<String> members) { this.members = members; }
    }

    public static class GroupUpdateRequest {
        private String name;
        private String iconUrl;
        private List<String> newMembers;

        public String getName() { return name; }
        public void setName(String name) { this.name = name; }
        public String getIconUrl() { return iconUrl; }
        public void setIconUrl(String iconUrl) { this.iconUrl = iconUrl; }
        public List<String> getNewMembers() { return newMembers; }
        public void setNewMembers(List<String> newMembers) { this.newMembers = newMembers; }
    }
}
