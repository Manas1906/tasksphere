package com.tasksphere.core.service;

import com.tasksphere.core.exception.ResourceNotFoundException;
import com.tasksphere.core.model.Task;
import com.tasksphere.core.model.TaskChecklistItem;
import com.tasksphere.core.repository.TaskRepository;
import com.tasksphere.core.repository.UserSessionRepository;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.util.List;

@Service
@Transactional
public class TaskService {

    @Autowired
    private TaskRepository taskRepository;

    @Autowired
    private UserSessionRepository userSessionRepository;

    public List<Task> getAllTasks() {
        return taskRepository.findAll();
    }

    public Task getTaskById(Long id) {
        return taskRepository.findById(id)
                .orElseThrow(() -> new ResourceNotFoundException("Task not found with ID: " + id));
    }

    public Task createTask(Task task) {
        // Link checklist items back to the parent task before saving
        if (task.getChecklist() != null) {
            task.getChecklist().forEach(item -> item.setTask(task));
        }
        
        // Resolve assignee if username is present in the sent object
        if (task.getAssignee() != null && task.getAssignee().getId() != null) {
            task.setAssignee(userSessionRepository.findById(task.getAssignee().getId()).orElse(null));
        }
        
        return taskRepository.save(task);
    }

    public Task updateTask(Long id, Task taskDetails) {
        Task task = getTaskById(id);

        task.setTitle(taskDetails.getTitle());
        task.setDescription(taskDetails.getDescription());
        task.setStatus(taskDetails.getStatus());
        task.setPriority(taskDetails.getPriority());
        task.setStoryPoints(taskDetails.getStoryPoints());
        task.setDueDate(taskDetails.getDueDate());

        // Resolve new assignee
        if (taskDetails.getAssignee() != null && taskDetails.getAssignee().getId() != null) {
            task.setAssignee(userSessionRepository.findById(taskDetails.getAssignee().getId()).orElse(null));
        } else {
            task.setAssignee(null);
        }

        // Merge checklist items
        task.getChecklist().clear();
        if (taskDetails.getChecklist() != null) {
            taskDetails.getChecklist().forEach(item -> {
                TaskChecklistItem newItem = TaskChecklistItem.builder()
                        .content(item.getContent())
                        .completed(item.isCompleted())
                        .task(task)
                        .build();
                task.getChecklist().add(newItem);
            });
        }

        return taskRepository.save(task);
    }

    public Task updateTaskStatus(Long id, String status) {
        Task task = getTaskById(id);
        task.setStatus(status);
        return taskRepository.save(task);
    }

    public void deleteTask(Long id) {
        Task task = getTaskById(id);
        taskRepository.delete(task);
    }
}
