package com.tasksphere.core.service;

import com.tasksphere.core.model.ChatMessage;
import com.tasksphere.core.repository.ChatMessageRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
@Transactional
public class ChatService {

    @Autowired
    private ChatMessageRepository chatMessageRepository;

    public List<ChatMessage> getRecentMessages() {
        return chatMessageRepository.findTop50ByOrderByTimestampAsc();
    }

    public ChatMessage saveMessage(ChatMessage message) {
        return chatMessageRepository.save(message);
    }

    public void clearHistory() {
        chatMessageRepository.deleteAll();
    }

    public ChatMessage updateMessage(Long id, String newMessageContent) {
        return chatMessageRepository.findById(id)
                .map(msg -> {
                    msg.setMessage(newMessageContent);
                    return chatMessageRepository.save(msg);
                })
                .orElseThrow(() -> new RuntimeException("Message not found with id: " + id));
    }
}
